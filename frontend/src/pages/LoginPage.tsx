import { type FormEvent, useMemo, useState } from "react";
import { AUTH_FEATURES, logIn, signUp, type User } from "../api";
import { LineChart, SERIES } from "../components/charts";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Brand } from "../components/Layout";
import { Badge, Notice, Segmented } from "../components/ui";
import { dailyCandles } from "../data/market";

type Props = {
  onSignedIn: (user: User) => void;
  notice?: string | null;
};

type Mode = "login" | "signup";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginPage({ onSignedIn, notice }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === "signup";

  const errors = {
    email: EMAIL.test(email.trim()) ? undefined : "Enter a valid email address",
    password:
      password.length === 0
        ? "Enter your password"
        : isSignUp && password.length < 12
          ? "Use at least 12 characters"
          : undefined,
    confirm: isSignUp && confirm !== password ? "Passwords don't match" : undefined,
  };
  const valid = !errors.email && !errors.password && !errors.confirm;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) await signUp(email.trim(), password);
      onSignedIn(await logIn(email.trim(), password, remember));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setTouched(false);
    setConfirm("");
  }

  return (
    <div className="login-page">
      <section className="login-hero" aria-hidden="false">
        <Brand />
        <div className="hero-copy">
          <Badge tone="info">AI-enhanced trading</Badge>
          <h1>
            Trade smarter.
            <br />
            Stay in control.
          </h1>
          <p>Strategy automation, explainable analysis, and rigorous risk management in one paper-trading workspace.</p>
          <ul className="hero-points">
            <li>
              <Icon name="sparkles" />
              <div>
                <strong>AI insights</strong>
                <span>Explainable recommendations</span>
              </div>
            </li>
            <li>
              <Icon name="shield" />
              <div>
                <strong>Risk first</strong>
                <span>Controls at every level</span>
              </div>
            </li>
          </ul>
        </div>
        <HeroChart />
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit} noValidate>
          <h2>{isSignUp ? "Create your account" : "Welcome back"}</h2>
          <p className="muted">{isSignUp ? "Start with a simulated paper-trading account." : "Sign in to continue to your trading workspace."}</p>

          {notice && <Notice tone="warning">{notice}</Notice>}

          {AUTH_FEATURES.signUp && (
            <Segmented
              label="Account action"
              className="auth-switch"
              value={mode}
              onChange={switchMode}
              options={[
                { value: "login", label: "Log in" },
                { value: "signup", label: "Sign up" },
              ]}
            />
          )}

          <Field label="Email address" error={touched ? errors.email : undefined}>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>

          <Field label="Password" error={touched ? errors.password : undefined} hint={isSignUp ? "At least 12 characters" : undefined}>
            <input
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {isSignUp && (
            <Field label="Confirm password" error={touched ? errors.confirm : undefined}>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          )}

          <div className="login-row">
            <label className="checkbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember me
            </label>
            {AUTH_FEATURES.passwordRecovery && !isSignUp && (
              <a className="link-btn" href="#forgot">
                Forgot password?
              </a>
            )}
          </div>

          {error && (
            <div className="auth-error" role="alert">
              <Icon name="alert" size={16} /> {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? "Please wait…" : isSignUp ? "Create account" : "Log in to TradeMind"}
            {!busy && <Icon name="chevronRight" size={16} />}
          </button>

          {AUTH_FEATURES.googleSignIn && (
            <>
              <div className="divider">or continue with</div>
              <button type="button" className="btn btn-secondary btn-lg">
                Google
              </button>
            </>
          )}

          <Notice tone="info" title="Demonstration environment">
            All trades and market data are simulated. No real funds are used.
          </Notice>
        </form>
      </section>
    </div>
  );
}

function HeroChart() {
  const points = useMemo(() => {
    const bars = dailyCandles("SPY").slice(-22);
    return bars.map((b) => ({ t: b.t, value: b.c }));
  }, []);
  const change = ((points[points.length - 1].value - points[0].value) / points[0].value) * 100;
  return (
    <div className="card hero-chart">
      <div className="card-head">
        <div className="card-titles">
          <h2 className="card-title">Simulated index, last month</h2>
        </div>
        <Badge tone={change >= 0 ? "success" : "danger"}>
          {change >= 0 ? "+" : "−"}
          {Math.abs(change).toFixed(2)}%
        </Badge>
      </div>
      <LineChart
        label="Simulated index value over the last month"
        height={170}
        series={[{ name: "Index", points, color: SERIES.primary }]}
        format={(v) => v.toFixed(0)}
      />
    </div>
  );
}
