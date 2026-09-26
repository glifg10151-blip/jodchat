import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { SkillInfo } from "../types";
import { logError } from "../utils/logger";

const SKILLS_CACHE_TTL_MS = 60_000;

let skillsLoadPromise: Promise<void> | null = null;
const skillReadPromises = new Map<string, Promise<string>>();

interface SkillStore {
  skills: SkillInfo[];
  skillContents: Record<string, string>;
  loading: boolean;
  lastLoadedAt: number | null;
  loadSkills: (force?: boolean) => Promise<void>;
  readSkill: (id: string, force?: boolean) => Promise<string>;
  createSkill: (id: string, name: string, description: string, body: string) => Promise<void>;
  updateSkill: (id: string, name: string, description: string, body: string) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  skillContents: {},
  loading: false,
  lastLoadedAt: null,

  loadSkills: async (force = false) => {
    const lastLoadedAt = get().lastLoadedAt;
    if (!force && lastLoadedAt !== null && Date.now() - lastLoadedAt < SKILLS_CACHE_TTL_MS) {
      return;
    }

    if (skillsLoadPromise) {
      return skillsLoadPromise;
    }

    set({ loading: true });
    const request = (async () => {
      try {
        const skills = await invoke<SkillInfo[]>("list_skills");
        set({ skills, lastLoadedAt: Date.now() });
      } catch (e) {
        set({ lastLoadedAt: null });
        logError("skills", "Failed to load skills", { error: e });
      } finally {
        set({ loading: false });
      }
    })();
    skillsLoadPromise = request;

    try {
      await request;
    } finally {
      if (skillsLoadPromise === request) {
        skillsLoadPromise = null;
      }
    }
  },

  readSkill: async (id: string, force = false) => {
    if (!force && Object.hasOwn(get().skillContents, id)) {
      return get().skillContents[id];
    }

    const pending = skillReadPromises.get(id);
    if (pending) {
      return pending;
    }

    const request = invoke<string>("read_skill", { id }).then((content) => {
      set((state) => ({
        skillContents: {
          ...state.skillContents,
          [id]: content,
        },
      }));
      return content;
    });
    skillReadPromises.set(id, request);

    try {
      return await request;
    } catch (e) {
      logError("skills", `Failed to read skill '${id}'`, { error: e });
      throw e;
    } finally {
      if (skillReadPromises.get(id) === request) {
        skillReadPromises.delete(id);
      }
    }
  },

  createSkill: async (id: string, name: string, description: string, body: string) => {
    try {
      await invoke("create_skill", { id, name, description, body });
      await get().loadSkills(true);
    } catch (e) {
      logError("skills", "Failed to create skill", { error: e });
      throw e;
    }
  },

  updateSkill: async (id: string, name: string, description: string, body: string) => {
    try {
      await invoke("update_skill", { id, name, description, body });
      set((state) => {
        const skillContents = { ...state.skillContents };
        delete skillContents[id];
        return { skillContents };
      });
      await get().loadSkills(true);
    } catch (e) {
      logError("skills", "Failed to update skill", { error: e });
      throw e;
    }
  },

  deleteSkill: async (id: string) => {
    try {
      await invoke("delete_skill", { id });
      set((state) => {
        const skillContents = { ...state.skillContents };
        delete skillContents[id];
        return { skillContents };
      });
      await get().loadSkills(true);
    } catch (e) {
      logError("skills", "Failed to delete skill", { error: e });
      throw e;
    }
  },
}));
