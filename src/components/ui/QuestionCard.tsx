import React, { useState } from "react";
import { motion } from "motion/react";
import { HelpCircle, ChevronRight } from "lucide-react";
import { motionTokens, motionTransitions } from "../../lib/motion-tokens";

interface QuestionCardProps {
  id: string;
  title: string;
  options: { value: string; label: string }[];
  onSubmit: (selectedValue: string, selectedLabel: string) => void;
  disabled?: boolean;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ id, title, options, onSubmit, disabled = false }) => {
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(disabled);

  const selectedLabel = options.find((opt) => opt.value === selectedValue)?.label || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedValue || hasSubmitted) return;
    setHasSubmitted(true);
    onSubmit(selectedValue, selectedLabel);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: motionTokens.distance.sm, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={motionTransitions.content}
      className="p-4 my-4 rounded-xl border border-border bg-surface/60 backdrop-blur-md flex flex-col gap-3 shadow-md max-w-lg w-full"
    >
      <div className="flex items-center gap-2 border-b border-border/50 pb-2">
        <HelpCircle size={16} className="text-accent shrink-0" />
        <span className="text-text-primary font-semibold text-xs leading-none">Clarifying Question</span>
      </div>
      <p className="text-sm text-text-secondary font-medium leading-normal">{title}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          {options.map((opt) => {
            const isSelected = selectedValue === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-[color,background-color,border-color,box-shadow,transform] ${
                  hasSubmitted
                    ? isSelected
                      ? "bg-accent/5 border-accent text-text-primary"
                      : "bg-surface/30 border-border/50 text-text-muted cursor-not-allowed"
                    : isSelected
                      ? "bg-accent/5 border-accent text-text-primary shadow-sm"
                      : "bg-surface/50 border-border/50 text-text-secondary hover:border-text-muted hover:bg-hover"
                }`}
              >
                <input
                  type="radio"
                  name={`question-${id}`}
                  value={opt.value}
                  checked={isSelected}
                  disabled={hasSubmitted}
                  onChange={() => setSelectedValue(opt.value)}
                  className="w-3.5 h-3.5 accent-accent mt-0.5 cursor-pointer shrink-0"
                />
                <span className="leading-snug">{opt.label}</span>
              </label>
            );
          })}
        </div>

        {!hasSubmitted && (
          <button
            type="submit"
            disabled={!selectedValue}
            className={`mt-2 flex items-center justify-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg transition-[color,background-color,border-color,box-shadow,opacity,transform] shadow-sm ${
              selectedValue
                ? "bg-accent hover:bg-accent-active text-accent-foreground cursor-pointer hover:shadow"
                : "bg-hover text-text-muted cursor-not-allowed"
            }`}
          >
            <span>Submit Answer</span>
            <ChevronRight size={14} className="shrink-0" />
          </button>
        )}
      </form>
    </motion.div>
  );
};
