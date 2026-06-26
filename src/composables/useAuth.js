import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

const LS_KEY = "prod-auth-v1";
const normalizeRole = (role) => (String(role).toLowerCase() === "admin" ? "admin" : "manager");

const loadSession = () => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    const session = raw ? JSON.parse(raw) : null;
    return session ? { ...session, role: normalizeRole(session.role) } : null;
  } catch (error) {
    return null;
  }
};

const saveSession = (value) => {
  if (typeof localStorage === "undefined") return;
  try {
    if (value) localStorage.setItem(LS_KEY, JSON.stringify(value));
    else localStorage.removeItem(LS_KEY);
  } catch (error) {
    // Saving is best effort for embedded contexts.
  }
};

const user = ref(loadSession());

export const useAuth = () => {
  const login = async (username, password) => {
    const cleanUsername = String(username).trim();
    if (!cleanUsername || !password) return { ok: false, error: "Enter username and password" };

    // public.users uses custom auth (plain-text password column, no Supabase Auth session).
    const { data, error } = await supabase
      .from("users")
      .select("id, username, name, role, password, active")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (error) return { ok: false, error: "Could not reach server" };
    if (!data || data.active === false || data.password !== password) {
      return { ok: false, error: "Invalid username or password" };
    }

    const session = { id: data.id, username: data.username, name: data.name, role: normalizeRole(data.role) };
    user.value = session;
    saveSession(session);
    return { ok: true };
  };

  const logout = () => {
    user.value = null;
    saveSession(null);
  };

  return { user, login, logout };
};