<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "../composables/useAuth.js";
import logoUrl from "../assets/thaidrill-logo.png";

const { login } = useAuth();
const router = useRouter();

const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

const submit = async () => {
  if (loading.value) return;
  error.value = "";
  loading.value = true;
  const result = await login(username.value, password.value);
  loading.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  router.push("/fleet");
};
</script>

<template>
  <div class="login-screen">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-brand">
        <img class="login-logo" :src="logoUrl" alt="ThaiDrill" />
        <div>
          <div class="brand-title">PRODUCTION CONTROL</div>
          <div class="brand-sub">Loading &amp; Hauling - Sign in</div>
        </div>
      </div>

      <label class="login-field">
        <span>Username</span>
        <input v-model="username" type="text" autocomplete="username" autofocus />
      </label>
      <label class="login-field">
        <span>Password</span>
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>

      <p v-if="error" class="login-error">{{ error }}</p>

      <button class="btn btn-primary login-submit" type="submit" :disabled="loading">
        {{ loading ? "Signing in..." : "Sign in" }}
      </button>
    </form>
  </div>
</template>