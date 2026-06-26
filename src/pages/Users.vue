<script setup>
import { computed, reactive, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useUsers } from "../composables/useUsers.js";
import TopBar from "../components/common/TopBar.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

const { users, loading, error, activeCount, loadUsers, addUser, updateUser, removeUser } = useUsers();

const roles = ["admin", "manager"];
const roleLabel = (role) => String(role).toUpperCase();
const query = ref("");
const message = ref("");
const saving = ref(false);
const addModalOpen = ref(false);
const editingId = ref("");
const visiblePasswords = ref({});
const showDraftPassword = ref(false);
const showEditPassword = ref(false);

const draft = reactive({ username: "", name: "", role: "manager", password: "", active: true });
const editDraft = reactive({ username: "", name: "", role: "manager", password: "", active: true });

const [t, setTweak] = useTweaks({
  accent: "#d99a00",
  density: "compact",
  theme: "light",
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t.theme;
  document.documentElement.dataset.density = t.density;
  document.documentElement.style.setProperty("--accent", t.accent);
});

const filteredUsers = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter((item) =>
    [item.username, item.name, item.role].some((value) => String(value).toLowerCase().includes(q)),
  );
});

const inactiveCount = computed(() => users.value.length - activeCount.value);

const togglePassword = (id) => {
  visiblePasswords.value = { ...visiblePasswords.value, [id]: !visiblePasswords.value[id] };
};

const resetDraft = () => {
  draft.username = "";
  draft.name = "";
  draft.role = "manager";
  draft.password = "";
  draft.active = true;
  showDraftPassword.value = false;
};

const openAddModal = () => {
  resetDraft();
  message.value = "";
  addModalOpen.value = true;
};

const closeAddModal = () => {
  addModalOpen.value = false;
  resetDraft();
};

const saveNewUser = async () => {
  if (saving.value) return;
  saving.value = true;
  const result = await addUser(draft);
  saving.value = false;
  if (!result.ok) {
    message.value = result.error;
    return;
  }
  message.value = `${result.user.username} added`;
  closeAddModal();
};

const startEdit = (item) => {
  editingId.value = item.id;
  editDraft.username = item.username;
  editDraft.name = item.name;
  editDraft.role = item.role === "admin" ? "admin" : "manager";
  editDraft.password = item.password || "";
  editDraft.active = item.active;
  showEditPassword.value = false;
  message.value = "";
};

const cancelEdit = () => {
  editingId.value = "";
  editDraft.password = "";
  showEditPassword.value = false;
};

const saveEdit = async (id) => {
  if (saving.value) return;
  saving.value = true;
  const result = await updateUser(id, editDraft);
  saving.value = false;
  if (!result.ok) {
    message.value = result.error;
    return;
  }
  message.value = `${result.user.username} updated`;
  cancelEdit();
};

const deleteUser = async (item) => {
  const ok = window.confirm(`Delete login for ${item.username}?`);
  if (!ok) return;
  const result = await removeUser(item.id);
  message.value = result.ok ? `${item.username} deleted` : result.error;
  if (editingId.value === item.id) cancelEdit();
};
</script>

<template>
  <div class="entry-dash mining-page users-page">
    <TopBar subtitle="Employee login" />

    <section class="mining-hero users-hero">
      <div>
        <span class="sum-k">Access control</span>
        <h1>Employee login</h1>
        <p>Manage usernames, passwords, roles, and active status for employees who sign in to this dashboard.</p>
      </div>
      <div class="users-stats">
        <div class="users-stat">
          <span class="sum-k">Total</span>
          <b class="mono">{{ users.length }}</b>
        </div>
        <div class="users-stat">
          <span class="sum-k">Active</span>
          <b class="mono accent">{{ activeCount }}</b>
        </div>
        <div class="users-stat">
          <span class="sum-k">Inactive</span>
          <b class="mono">{{ inactiveCount }}</b>
        </div>
      </div>
    </section>

    <main class="mining-layout mining-layout-single">
      <section class="mining-list panel">
        <div class="mining-toolbar users-toolbar">
          <p v-if="message" class="mining-message">{{ message }}</p>
          <p v-else-if="error" class="mining-message error-text">{{ error }}</p>
          <span v-else />
          <div class="users-actions">
            <input v-model="query" class="users-search" type="search" placeholder="Search employee" />
            <button class="mini-action" type="button" :disabled="loading" @click="loadUsers">Refresh</button>
            <button class="add-exc" type="button" @click="openAddModal">+ Add user</button>
          </div>
        </div>

        <div class="panel-head">
          <h2>Saved employee logins</h2>
          <span class="area-count-pill mono">{{ filteredUsers.length }} shown</span>
        </div>

        <div class="users-table">
          <div class="users-row users-row-head">
            <span>Username</span>
            <span>Name</span>
            <span>Role</span>
            <span>Password</span>
            <span>Status</span>
            <span>Action</span>
          </div>

          <div v-if="loading && !users.length" class="users-empty">Loading employee logins...</div>
          <div v-else-if="!filteredUsers.length" class="users-empty">No employee logins found</div>

          <div v-for="item in filteredUsers" :key="item.id" class="users-row">
            <input v-if="editingId === item.id" v-model="editDraft.username" class="users-input mono" autocomplete="off" />
            <span v-else class="mining-code mono">{{ item.username }}</span>

            <input v-if="editingId === item.id" v-model="editDraft.name" class="users-input" autocomplete="off" />
            <span v-else>{{ item.name || '-' }}</span>

            <select v-if="editingId === item.id" v-model="editDraft.role" class="users-input users-select">
              <option v-for="role in roles" :key="role" :value="role">{{ roleLabel(role) }}</option>
            </select>
            <span v-else class="chip users-role-chip">{{ roleLabel(item.role) }}</span>

            <div v-if="editingId === item.id" class="users-password-cell">
              <input
                v-model="editDraft.password"
                class="users-input"
                :type="showEditPassword ? 'text' : 'password'"
                autocomplete="new-password"
              />
              <button class="mini-action" type="button" @click="showEditPassword = !showEditPassword">
                {{ showEditPassword ? 'Hide' : 'Show' }}
              </button>
            </div>
            <div v-else class="users-password-cell">
              <span v-if="visiblePasswords[item.id]" class="users-password-text mono">{{ item.password }}</span>
              <span v-else class="users-password-text mono">&bull;&bull;&bull;&bull;&bull;&bull;</span>
              <button class="mini-action" type="button" @click="togglePassword(item.id)">
                {{ visiblePasswords[item.id] ? 'Hide' : 'Show' }}
              </button>
            </div>

            <label v-if="editingId === item.id" class="users-check">
              <input v-model="editDraft.active" type="checkbox" />
              Active
            </label>
            <span v-else class="status-pill" :class="item.active ? 'status-on' : 'status-off'">
              {{ item.active ? 'Active' : 'Inactive' }}
            </span>

            <div class="mining-actions">
              <template v-if="editingId === item.id">
                <button class="mini-action primary" type="button" :disabled="saving" @click="saveEdit(item.id)">Save</button>
                <button class="mini-action" type="button" :disabled="saving" @click="cancelEdit">Cancel</button>
              </template>
              <template v-else>
                <button class="mini-action" type="button" @click="startEdit(item)">Edit</button>
                <button class="gt-del" type="button" aria-label="Delete employee login" @click="deleteUser(item)">x</button>
              </template>
            </div>
          </div>
        </div>
      </section>
    </main>

    <div v-if="addModalOpen" class="modal-overlay" @mousedown.self="closeAddModal">
      <div class="modal users-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">Add employee login</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeAddModal">x</button>
        </div>
        <div class="modal-body users-form">
          <label class="mining-label" for="user-username">Username</label>
          <input id="user-username" v-model="draft.username" class="mining-input mono" autocomplete="off" autofocus />

          <label class="mining-label" for="user-name">Employee name</label>
          <input id="user-name" v-model="draft.name" class="mining-input" autocomplete="off" />

          <label class="mining-label" for="user-role">Role</label>
          <select id="user-role" v-model="draft.role" class="mining-input">
            <option v-for="role in roles" :key="role" :value="role">{{ roleLabel(role) }}</option>
          </select>

          <label class="mining-label" for="user-password">Password</label>
          <div class="users-password-cell users-password-form">
            <input
              id="user-password"
              v-model="draft.password"
              class="mining-input"
              :type="showDraftPassword ? 'text' : 'password'"
              autocomplete="new-password"
              @keydown.enter="saveNewUser"
            />
            <button class="mini-action" type="button" @click="showDraftPassword = !showDraftPassword">
              {{ showDraftPassword ? 'Hide' : 'Show' }}
            </button>
          </div>

          <label class="users-check users-check-form">
            <input v-model="draft.active" type="checkbox" />
            Active login
          </label>
          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">This app uses the existing custom users table.</span>
          <div class="foot-actions">
            <button class="btn" type="button" :disabled="saving" @click="closeAddModal">Cancel</button>
            <button class="btn btn-primary" type="button" :disabled="saving" @click="saveNewUser">Add</button>
          </div>
        </div>
      </div>
    </div>

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>