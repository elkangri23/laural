import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ModalShell } from "./ModalShell";
import { useLanguage } from "../i18n";

export const SETTINGS_CATEGORIES = [
  { id: "personalization", label: "Personalización" },
  { id: "ai", label: "IA" },
  { id: "agent", label: "Agente y terminal" },
  { id: "data", label: "Datos y cuenta" },
  { id: "application", label: "Aplicación" },
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]["id"];

type SettingsDialogProps = {
  sections: Record<SettingsCategory, ReactNode>;
  activeCategory: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  onClose: () => void;
};

export function SettingsDialog({ sections, activeCategory, onCategoryChange, onClose }: SettingsDialogProps) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const { messages } = useLanguage();

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? SETTINGS_CATEGORIES.length - 1
        : (index + direction + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length;

    if (direction === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextCategory = SETTINGS_CATEGORIES[nextIndex];
    onCategoryChange(nextCategory.id);
    tabs.current[nextIndex]?.focus();
  }

  return (
    <ModalShell className="appearance-dialog settings-dialog" onClose={onClose} title={messages.settings.title}>
      <div className="settings-layout">
        <nav className="settings-tabs" role="tablist" aria-label={messages.settings.categoriesLabel}>
          {SETTINGS_CATEGORIES.map((category, index) => (
            <button
              key={category.id}
              ref={(element) => { tabs.current[index] = element; }}
              id={`settings-tab-${category.id}`}
              className="settings-tab"
              role="tab"
              type="button"
              aria-selected={category.id === activeCategory}
              aria-controls="settings-category-panel"
              tabIndex={category.id === activeCategory ? 0 : -1}
              onClick={() => onCategoryChange(category.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {messages.settings.categories[category.id]}
            </button>
          ))}
        </nav>
        <label className="settings-compact-nav">
          <span className="visually-hidden">{messages.settings.categoryLabel}</span>
          <select value={activeCategory} onChange={(event) => onCategoryChange(event.currentTarget.value as SettingsCategory)}>
            {SETTINGS_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{messages.settings.categories[category.id]}</option>)}
          </select>
        </label>
        <section
          id="settings-category-panel"
          className="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeCategory}`}
          tabIndex={0}
        >
          {sections[activeCategory]}
        </section>
      </div>
    </ModalShell>
  );
}
