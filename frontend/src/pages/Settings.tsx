import { type FormEvent, type ReactNode, useState } from "react";
import { confirmPassword } from "../api";
import { Field } from "../components/Field";
import { Badge, Card, Modal, Notice, SaveStatus, Tabs, Toggle } from "../components/ui";
import { SESSION_TIMEOUT, validateSettings } from "../data/rules";
import { resetDemoData, saveSettings } from "../data/service";
import type { UserSettings } from "../data/types";
import { errorMessage, initials, monthYear } from "../lib/format";
import { type SaveStatus as SaveStatusValue, useSave } from "../lib/hooks";
import { useSession } from "../lib/session";

type Tab = "profile" | "trading" | "notifications" | "security";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Central Europe" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "UTC", label: "UTC" },
];

export function Settings() {
  const { user, settings, setSettings } = useSession();
  const [tab, setTab] = useState<Tab>("profile");
  const memberSince = monthYear(user.created_at, settings.timezone);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="muted">Manage your account, paper trading defaults, alerts, and security.</p>
        </div>
      </div>

      <Tabs
        label="Settings sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: "profile", label: "Profile", icon: "user" },
          { value: "trading", label: "Trading Preferences", icon: "sliders" },
          { value: "notifications", label: "Notifications", icon: "bell" },
          { value: "security", label: "Security", icon: "lock" },
        ]}
      />

      <div className="grid-side wide-side">
        <div>
          {tab === "profile" && <ProfileForm settings={settings} email={user.email} onSaved={setSettings} />}
          {tab === "trading" && <TradingForm settings={settings} email={user.email} onSaved={setSettings} />}
          {tab === "notifications" && <NotificationsForm settings={settings} onSaved={setSettings} />}
          {tab === "security" && <SecurityForm settings={settings} email={user.email} onSaved={setSettings} />}
        </div>
        <aside className="card profile-card">
          <span className="avatar xl">{initials(settings.displayName)}</span>
          <strong>{settings.displayName}</strong>
          <span className="muted small">{user.email}</span>
          <Badge tone="success" dot>
            Signed in
          </Badge>
          <dl className="kv">
            <div><dt>Member since</dt><dd>{memberSince}</dd></div>
            <div><dt>Account type</dt><dd>Paper trading (demo)</dd></div>
            <div><dt>Time zone</dt><dd>{settings.timezone}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

type FormProps = { settings: UserSettings; onSaved: (s: UserSettings) => void };

/** Saves settings through the shared save hook and pushes the result into the session. */
function useSettingsSave(onSaved: (s: UserSettings) => void) {
  const { saving, status, run } = useSave();
  const save = async (next: UserSettings, message: string) => {
    const saved = await run(() => saveSettings(next), message);
    if (saved) onSaved(saved);
  };
  return { saving, status, save };
}

function SaveBar({ saving, status, label, disabled }: { saving: boolean; status: SaveStatusValue; label: string; disabled?: boolean }) {
  return (
    <footer className="form-footer">
      <SaveStatus status={status} />
      <button type="submit" className="btn btn-primary" disabled={saving || disabled}>
        {saving ? "Saving…" : label}
      </button>
    </footer>
  );
}

function ProfileForm({ settings, email, onSaved }: FormProps & { email: string }) {
  const [name, setName] = useState(settings.displayName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [touched, setTouched] = useState(false);
  const { saving, status, save } = useSettingsSave(onSaved);
  const nameError = validateSettings({ ...settings, displayName: name }).displayName;
  const zones = TIMEZONES.some((z) => z.value === settings.timezone) ? TIMEZONES : [{ value: settings.timezone, label: settings.timezone }, ...TIMEZONES];

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError) return;
    void save({ ...settings, displayName: name.trim(), timezone }, "Profile saved.");
  }

  return (
    <Card title="Profile information" subtitle="Update your personal account details." icon="user">
      <form onSubmit={submit} noValidate className="stack-sm">
        <Field label="Display name" error={touched ? nameError : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Email address" hint="Changing your email isn't supported yet.">
          <input value={email} disabled readOnly />
        </Field>
        <Field label="Time zone" hint="Controls how dates and times are shown.">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
        </Field>
        <SaveBar saving={saving} status={status} label="Save profile" />
      </form>
    </Card>
  );
}

/** Asks for the account password before a sensitive change (REQ-0802). */
function ReauthDialog({ open, email, onCancel, onConfirmed, children }: { open: boolean; email: string; onCancel: () => void; onConfirmed: () => void; children: ReactNode }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPassword(email, password);
      setPassword("");
      onConfirmed();
    } catch (err) {
      setError(errorMessage(err, "Couldn't confirm your password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onCancel} labelledBy="reauth-title" width={440}>
      <form onSubmit={submit} className="stack-sm" noValidate>
        <h2 id="reauth-title" className="modal-title">
          Confirm it's you
        </h2>
        <p className="muted">{children}</p>
        <Field label="Password" error={error ?? undefined}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <div className="button-row end">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!password || busy}>
            {busy ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TradingForm({ settings, email, onSaved }: FormProps & { email: string }) {
  const [mode, setMode] = useState(settings.defaultTradingMode);
  const [confirming, setConfirming] = useState(false);
  const { saving, status, save } = useSettingsSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode !== settings.defaultTradingMode) setConfirming(true);
  }

  return (
    <Card title="Trading preferences" subtitle="Defaults for new orders and strategies." icon="sliders">
      <form onSubmit={submit} className="stack-sm" noValidate>
        <Field label="Default trading mode" hint="Live trading is not available in this prototype.">
          <select value={mode} onChange={(e) => setMode(e.target.value as UserSettings["defaultTradingMode"])}>
            <option value="paper">Paper (simulated)</option>
            <option value="live" disabled>
              Live (not available)
            </option>
          </select>
        </Field>
        <Notice tone="info">
          Changing the trading mode requires your password. The server applies its own safety checks regardless of this preference.
        </Notice>
        <SaveBar saving={saving} status={status} label="Save preferences" disabled={mode === settings.defaultTradingMode} />
      </form>
      <ReauthDialog
        open={confirming}
        email={email}
        onCancel={() => setConfirming(false)}
        onConfirmed={() => {
          setConfirming(false);
          void save({ ...settings, defaultTradingMode: mode }, "Trading preferences saved.");
        }}
      >
        Enter your password to change the default trading mode.
      </ReauthDialog>
    </Card>
  );
}

function NotificationsForm({ settings, onSaved }: FormProps) {
  const [prefs, setPrefs] = useState(settings.notifications);
  const { saving, status, save } = useSettingsSave(onSaved);
  const items: { key: keyof UserSettings["notifications"]; label: string; text: string }[] = [
    { key: "tradeApprovals", label: "Trade approval requests", text: "When a strategy proposes a trade that needs your decision." },
    { key: "orderFills", label: "Order fills", text: "When a paper order is filled." },
    { key: "riskAlerts", label: "Risk alerts", text: "When exposure or loss limits are approached or breached." },
    { key: "systemAlerts", label: "System alerts", text: "Strategy starts, stops, and engine errors." },
  ];
  return (
    <Card title="Notifications" subtitle="Choose which in-app alerts you receive." icon="bell">
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ ...settings, notifications: prefs }, "Notification preferences saved.");
        }}
      >
        {items.map((item) => (
          <div className="toggle-row" key={item.key}>
            <div>
              <strong>{item.label}</strong>
              <span className="muted small">{item.text}</span>
            </div>
            <Toggle label={item.label} checked={prefs[item.key]} onChange={(v) => setPrefs({ ...prefs, [item.key]: v })} />
          </div>
        ))}
        <SaveBar saving={saving} status={status} label="Save notifications" />
      </form>
    </Card>
  );
}

function SecurityForm({ settings, email, onSaved }: FormProps & { email: string }) {
  const [timeout, setTimeoutValue] = useState(String(settings.sessionTimeoutMinutes));
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const { saving, status, save } = useSettingsSave(onSaved);
  const n = Number(timeout);
  const error = validateSettings({ ...settings, sessionTimeoutMinutes: n }).sessionTimeoutMinutes;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error || n === settings.sessionTimeoutMinutes) return;
    setConfirming(true);
  }

  return (
    <div className="stack">
      <Card title="Session & sign-in" subtitle="Control how long you stay signed in." icon="lock">
        <form onSubmit={submit} className="stack-sm" noValidate>
          <Field label="Session timeout (minutes)" error={touched ? error : undefined} hint={`Allowed range: ${SESSION_TIMEOUT.min} to ${SESSION_TIMEOUT.max} minutes. The server session also expires after 12 hours.`}>
            <input inputMode="numeric" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} />
          </Field>
          <div className="toggle-row">
            <div>
              <strong>Two-factor authentication</strong>
              <span className="muted small">
                {settings.twoFactorEnabled === null ? "Not available yet — the authentication service doesn't support it." : settings.twoFactorEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <Badge tone="neutral">{settings.twoFactorEnabled ? "On" : "Unavailable"}</Badge>
          </div>
          <SaveBar saving={saving} status={status} label="Save security settings" />
        </form>
        <ReauthDialog
          open={confirming}
          email={email}
          onCancel={() => setConfirming(false)}
          onConfirmed={() => {
            setConfirming(false);
            void save({ ...settings, sessionTimeoutMinutes: n }, "Security settings saved.");
          }}
        >
          Enter your password to change your session timeout.
        </ReauthDialog>
      </Card>

      <Card title="Credentials" subtitle="How your secrets are handled" icon="shieldCheck">
        <ul className="plain-list muted small">
          <li>Your password is stored only as a salted scrypt hash on the server.</li>
          <li>Broker and data-provider API keys live on the server and are never sent to this app.</li>
          <li>Session tokens are stored as hashes server-side and revoked when you log out.</li>
        </ul>
      </Card>

      <Card title="Demo data" subtitle="Reset the simulated portfolio, orders, and strategies for this account." icon="refresh">
        <div className="button-row">
          <button
            type="button"
            className="btn btn-danger-soft"
            onClick={() => {
              resetDemoData();
              setResetDone(true);
              window.setTimeout(() => window.location.assign("/"), 600);
            }}
          >
            Reset demo data
          </button>
          <SaveStatus status={resetDone ? { tone: "success", text: "Reset. Reloading…" } : null} />
        </div>
      </Card>
    </div>
  );
}
