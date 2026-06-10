interface SettingsProps {
  activeProject?: AiddTrackedProject | null;
  themeMode: 'system' | 'light' | 'dark';
  onThemeModeChange: (mode: 'system' | 'light' | 'dark') => void;
}

export function Settings({ activeProject, themeMode, onThemeModeChange }: SettingsProps) {
  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>App settings</h1>
          <p className="muted">Settings are stored locally on this machine. Project workflow state stays in Markdown frontmatter.</p>
        </div>
      </header>

      <section className="settingsGrid">
        <div className="panel">
          <h2>Appearance</h2>
          <p className="muted">Choose a theme or follow the operating system.</p>
          <div className="segmentedControl">
            <button className={themeMode === 'system' ? 'active' : ''} onClick={() => onThemeModeChange('system')}>Follow OS</button>
            <button className={themeMode === 'light' ? 'active' : ''} onClick={() => onThemeModeChange('light')}>Light</button>
            <button className={themeMode === 'dark' ? 'active' : ''} onClick={() => onThemeModeChange('dark')}>Dark</button>
          </div>
        </div>

        <div className="panel">
          <h2>Current project</h2>
          {activeProject ? (
            <dl className="settingsList">
              <div><dt>Name</dt><dd>{activeProject.name}</dd></div>
              <div><dt>Path</dt><dd>{activeProject.path}</dd></div>
              <div><dt>Template</dt><dd>{activeProject.templateId}@{activeProject.templateVersion}</dd></div>
            </dl>
          ) : <p className="muted">No active project selected.</p>}
        </div>

        <div className="panel">
          <h2>Delivery rules vs standards</h2>
          <p className="muted">Delivery rules are workflow guardrails: review gates, AI usage rules, and verification expectations. Technical choices such as JavaScript, Java, SOLID, coding style, test scripts, and UI testing live under Standards.</p>
        </div>
      </section>
    </main>
  );
}
