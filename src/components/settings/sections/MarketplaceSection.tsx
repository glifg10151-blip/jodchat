import { useState } from "react";
import { Download, Check, Palette, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useUIStore } from "../../../store/useUIStore";
import { MARKETPLACE_THEMES, MarketplaceTheme } from "../../../config/marketplaceThemes";
import { getContrastColor } from "../../../config/themePresets";
import { springs, motionTokens, motionTransitions } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";

// Child card component to manage local hover state and separate animations
const ThemeCard = ({
  theme,
  isDownloaded,
  isCurrentlyApplied,
  onGet,
  onApply,
  onDelete,
}: {
  theme: MarketplaceTheme;
  isDownloaded: boolean;
  isCurrentlyApplied: boolean;
  onGet: () => void;
  onApply: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const animationsDisabled = useUIStore((s) => s.animationsDisabled);
  const prefersReducedMotion = useReducedMotion();
  const motionEnabled = !animationsDisabled && !prefersReducedMotion;

  const handleCardClick = () => {
    if (isCurrentlyApplied) return;
    if (isDownloaded) {
      onApply();
    } else {
      onGet();
    }
  };

  // Soft neutral border and subtle shadow on hover (avoiding colored neon/glows)
  const dynamicStyle =
    isHovered && !animationsDisabled
      ? {
          borderColor: "var(--theme-text-muted)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
        }
      : {
          borderColor: "var(--theme-border)",
        };

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: motionTransitions.content },
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={motionEnabled ? { scale: 1.008 } : undefined}
      whileTap={motionEnabled ? { scale: motionTokens.scale.press } : undefined}
      transition={springs.snappy}
      onClick={handleCardClick}
      className={`bg-surface border rounded-xl overflow-hidden flex flex-col sm:flex-row items-stretch shadow-sm transition-[border-color,box-shadow,transform] relative ${
        isCurrentlyApplied ? "cursor-default" : "cursor-pointer"
      }`}
      style={dynamicStyle}
    >
      {/* Detailed mock-up of Sythoria application window */}
      <div
        className="w-full sm:w-44 h-28 shrink-0 relative overflow-hidden flex select-none"
        style={{ backgroundColor: theme.config.background }}
      >
        {/* Mock Sidebar */}
        <div
          className="w-[30%] flex flex-col gap-1.5 p-2 h-full border-r relative shrink-0"
          style={{
            borderColor: `${theme.config.foreground}12`,
          }}
        >
          {/* Sidebar overlay contrast (mixes foreground color at 8% opacity) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundColor: theme.config.foreground, opacity: 0.08 }}
          />
          <div
            className="w-4 h-4 rounded-full mb-1 shrink-0"
            style={{ backgroundColor: `${theme.config.foreground}25` }}
          />
          <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: `${theme.config.foreground}20` }} />
          <div className="h-1.5 w-5/6 rounded-sm" style={{ backgroundColor: `${theme.config.foreground}15` }} />
          <div className="h-1.5 w-11/12 rounded-sm" style={{ backgroundColor: theme.config.accent, opacity: 0.25 }} />
        </div>

        {/* Mock Chat Area */}
        <div className="flex-1 flex flex-col justify-between p-2 h-full">
          {/* Mock Messages */}
          <div className="flex flex-col gap-1.5 items-end">
            {/* User message bubble */}
            <div
              className="h-4 w-16 rounded-md rounded-tr-none flex items-center justify-end px-1.5"
              style={{ backgroundColor: `${theme.config.foreground}12` }}
            >
              <div className="h-1 w-10 rounded-sm" style={{ backgroundColor: `${theme.config.foreground}20` }} />
            </div>

            {/* Assistant response */}
            <div className="flex gap-1 items-start w-full mt-0.5">
              <div
                className="w-3 h-3 rounded-full shrink-0 flex items-center justify-center"
                style={{ backgroundColor: theme.config.accent }}
              >
                <div className="w-1 h-1 rounded-full bg-white" />
              </div>
              <div className="flex flex-col gap-1 flex-1 pt-0.5">
                <div className="h-1 w-full rounded-sm" style={{ backgroundColor: `${theme.config.foreground}22` }} />
                <div className="h-1 w-4/5 rounded-sm" style={{ backgroundColor: `${theme.config.foreground}15` }} />
              </div>
            </div>
          </div>

          {/* Mock Input Bar */}
          <div
            className="h-4.5 rounded border flex items-center px-1.5 gap-1 w-full shrink-0"
            style={{
              backgroundColor: `${theme.config.foreground}04`,
              borderColor: `${theme.config.foreground}12`,
            }}
          >
            <div className="h-1 w-14 rounded-sm" style={{ backgroundColor: `${theme.config.foreground}18` }} />
            <div className="w-2 h-2 rounded-full ml-auto" style={{ backgroundColor: theme.config.accent }} />
          </div>
        </div>
      </div>

      {/* Card Info Section */}
      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between flex-1 gap-4 bg-surface min-w-0">
        {/* Info Column */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-text-primary truncate">{theme.name}</h4>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-hover text-text-secondary uppercase tracking-wider shrink-0">
              {theme.type}
            </span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-1 sm:line-clamp-2">
            {theme.description}
          </p>
          <span className="text-[10px] text-text-muted mt-1">
            {t("settings.marketplace.author", { author: theme.author })}
          </span>
        </div>

        {/* Action Button */}
        <div className="shrink-0 flex items-center self-end sm:self-center">
          {isCurrentlyApplied ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-sm">
                <Check size={12} className="stroke-[3]" />
                <span>{t("settings.marketplace.active")}</span>
              </div>
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                whileHover={!animationsDisabled ? { scale: motionTokens.scale.pop } : undefined}
                whileTap={!animationsDisabled ? { scale: motionTokens.scale.press } : undefined}
                transition={springs.snappy}
                className="p-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-red-500 hover:border-red-500/20 hover:bg-red-500/5 transition-[color,background-color,border-color,box-shadow,transform] shadow-sm"
                title={t("settings.marketplace.deleteThemeTooltip")}
              >
                <Trash2 size={12} />
              </motion.button>
            </div>
          ) : isDownloaded ? (
            <div className="flex items-center gap-2">
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  onApply();
                }}
                whileHover={!animationsDisabled ? { scale: motionTokens.scale.pop } : undefined}
                whileTap={!animationsDisabled ? { scale: motionTokens.scale.press } : undefined}
                transition={springs.snappy}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-[color,background-color,border-color,box-shadow,transform] bg-surface hover:bg-hover text-text-primary border border-border shadow-sm"
              >
                <Palette size={12} />
                <span>{t("settings.marketplace.apply")}</span>
              </motion.button>
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                whileHover={!animationsDisabled ? { scale: motionTokens.scale.pop } : undefined}
                whileTap={!animationsDisabled ? { scale: motionTokens.scale.press } : undefined}
                transition={springs.snappy}
                className="p-1.5 rounded-lg border border-border bg-surface text-text-muted hover:text-red-500 hover:border-red-500/20 hover:bg-red-500/5 transition-[color,background-color,border-color,box-shadow,transform] shadow-sm"
                title={t("settings.marketplace.deleteThemeTooltip")}
              >
                <Trash2 size={12} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                onGet();
              }}
              whileHover={!animationsDisabled ? { scale: motionTokens.scale.pop } : undefined}
              whileTap={!animationsDisabled ? { scale: motionTokens.scale.press } : undefined}
              transition={springs.snappy}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-[color,background-color,border-color,box-shadow,transform] shadow-sm hover:shadow-md"
              style={{
                backgroundColor: theme.config.accent,
                color: getContrastColor(theme.config.accent),
              }}
            >
              <Download size={12} />
              <span>{t("settings.marketplace.get")}</span>
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export const MarketplaceSection = () => {
  const { t } = useTranslation();
  const downloadedThemes = useUIStore((s) => s.downloadedThemes);
  const downloadTheme = useUIStore((s) => s.downloadTheme);
  const deleteTheme = useUIStore((s) => s.deleteTheme);
  const activeTheme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const addToast = useUIStore((s) => s.addToast);
  const animationsDisabled = useUIStore((s) => s.animationsDisabled);
  const prefersReducedMotion = useReducedMotion();
  const motionEnabled = !animationsDisabled && !prefersReducedMotion;

  const [filter, setFilter] = useState<"all" | "light" | "dark">("all");

  const filteredThemes = MARKETPLACE_THEMES.filter((theme) => filter === "all" || theme.type === filter);

  const handleApply = (theme: MarketplaceTheme) => {
    const newTheme = {
      ...activeTheme,
      mode: theme.type, // Switch to theme mode to immediately display applied theme
      [theme.type === "light" ? "lightTheme" : "darkTheme"]: {
        ...theme.config,
      },
    };
    setTheme(newTheme);
    addToast(t("settings.marketplace.appliedToast", { name: theme.name }), "success");
  };

  const handleGet = (theme: MarketplaceTheme) => {
    downloadTheme(theme.type, theme.name, theme.config);
    addToast(t("settings.marketplace.downloadedToast", { name: theme.name }), "success");
  };

  const handleDelete = (theme: MarketplaceTheme) => {
    deleteTheme(theme.type, theme.name);
    addToast(t("settings.marketplace.deletedToast", { name: theme.name }), "info");
  };

  return (
    <>
      <div className="mb-4">
        <h3 className="text-lg font-semibold tracking-tight text-text-primary mb-1">{t("section.marketplace")}</h3>
        <p className="text-xs text-text-muted">{t("settings.marketplace.subtitle")}</p>
      </div>

      {/* Glassmorphic Segmented Filter Pill */}
      <div className="flex border border-border/40 bg-surface/30 backdrop-blur-md p-1 rounded-xl w-fit mb-6 shadow-sm">
        {(["all", "light", "dark"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-[color,background-color,box-shadow,transform] ${
              filter === f
                ? "bg-text-primary text-surface shadow-sm"
                : "text-text-muted hover:text-text-primary hover:bg-hover/50"
            }`}
          >
            {f === "all"
              ? t("settings.marketplace.filterAll")
              : f === "light"
                ? t("settings.marketplace.filterLight")
                : t("settings.marketplace.filterDark")}
          </button>
        ))}
      </div>

      {/* List of Themes with Stagger Animations */}
      <motion.div
        key={filter} // Forces clean re-animate on filter change
        variants={{
          hidden: { opacity: 0 },
          show: {
            opacity: 1,
            transition: {
              ...motionTransitions.content,
              staggerChildren: motionEnabled ? 0.055 : 0,
            },
          },
        }}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-3 pb-8"
      >
        {filteredThemes.map((theme) => {
          const isDownloaded = !!downloadedThemes[theme.type][theme.name];

          // Theme is active if it matches the current mode's config colors
          const isCurrentlyApplied =
            (theme.type === "light" &&
              activeTheme.mode === "light" &&
              activeTheme.lightTheme.background.toLowerCase() === theme.config.background.toLowerCase() &&
              activeTheme.lightTheme.foreground.toLowerCase() === theme.config.foreground.toLowerCase() &&
              activeTheme.lightTheme.accent.toLowerCase() === theme.config.accent.toLowerCase()) ||
            (theme.type === "dark" &&
              activeTheme.mode === "dark" &&
              activeTheme.darkTheme.background.toLowerCase() === theme.config.background.toLowerCase() &&
              activeTheme.darkTheme.foreground.toLowerCase() === theme.config.foreground.toLowerCase() &&
              activeTheme.darkTheme.accent.toLowerCase() === theme.config.accent.toLowerCase());

          return (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isDownloaded={isDownloaded}
              isCurrentlyApplied={isCurrentlyApplied}
              onGet={() => handleGet(theme)}
              onApply={() => handleApply(theme)}
              onDelete={() => handleDelete(theme)}
            />
          );
        })}
      </motion.div>
    </>
  );
};
