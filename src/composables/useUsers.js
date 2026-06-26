import { computed, ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

const users = ref([]);
const loading = ref(false);
const error = ref("");
const normalizeRole = (role) => (String(role).toLowerCase() === "admin" ? "admin" : "manager");

const normalizeUser = (row) => ({
  id: row.id,
  username: row.username || "",
  name: row.name || "",
  role: normalizeRole(row.role),
  password: row.password || "",
  active: row.active !== false,
});

const sortUsers = () => {
  users.value = [...users.value].sort((a, b) => a.username.localeCompare(b.username));
};

const loadUsers = async () => {
  loading.value = true;
  error.value = "";
  const { data, error: loadError } = await supabase
    .from("users")
    .select("id, username, name, role, password, active")
    .order("username", { ascending: true });
  loading.value = false;

  if (loadError) {
    error.value = "Could not load employee logins";
    return { ok: false, error: error.value };
  }

  users.value = (data || []).map(normalizeUser);
  sortUsers();
  return { ok: true };
};

loadUsers();

export const useUsers = () => {
  const activeCount = computed(() => users.value.filter((item) => item.active).length);

  const addUser = async (payload) => {
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");
    const name = String(payload.name || "").trim();
    const role = normalizeRole(payload.role);
    const active = payload.active !== false;

    if (!username || !password) return { ok: false, error: "Username and password are required" };
    if (users.value.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: `${username} already exists` };
    }

    const { data, error: insertError } = await supabase
      .from("users")
      .insert({ username, password, name, role, active })
      .select("id, username, name, role, password, active")
      .single();

    if (insertError) return { ok: false, error: "Could not add employee login" };
    users.value = [...users.value, normalizeUser(data)];
    sortUsers();
    return { ok: true, user: normalizeUser(data) };
  };

  const updateUser = async (id, payload) => {
    const username = String(payload.username || "").trim();
    const name = String(payload.name || "").trim();
    const role = normalizeRole(payload.role);
    const password = String(payload.password || "");
    const active = payload.active !== false;

    if (!username) return { ok: false, error: "Username is required" };
    if (users.value.some((item) => item.id !== id && item.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: `${username} already exists` };
    }

    const changes = { username, name, role, active };
    if (password) changes.password = password;

    const { data, error: updateError } = await supabase
      .from("users")
      .update(changes)
      .eq("id", id)
      .select("id, username, name, role, password, active")
      .single();

    if (updateError) return { ok: false, error: "Could not update employee login" };
    users.value = users.value.map((item) => (item.id === id ? normalizeUser(data) : item));
    sortUsers();
    return { ok: true, user: normalizeUser(data) };
  };

  const removeUser = async (id) => {
    const target = users.value.find((item) => item.id === id);
    if (!target) return { ok: false, error: "Employee login not found" };

    const { error: deleteError } = await supabase.from("users").delete().eq("id", id);
    if (deleteError) return { ok: false, error: "Could not delete employee login" };
    users.value = users.value.filter((item) => item.id !== id);
    return { ok: true, user: target };
  };

  return { users, loading, error, activeCount, loadUsers, addUser, updateUser, removeUser };
};