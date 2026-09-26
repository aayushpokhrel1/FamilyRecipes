import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getAvatarUrl, getMyProfile, updateDisplayName, updatePreferences, uploadAvatar } from "../lib/api/profile";
import { deleteAccount } from "../lib/api/account";
import { changePassword } from "../lib/api/auth";
import FamilyDataPanel from "../components/FamilyDataPanel";
import IdentitiesPanel from "../components/IdentitiesPanel";
import { getTheme, setTheme, type ThemeChoice } from "../lib/theme";
import type { Preferences, Profile } from "../lib/api/types";

// Mirrors LENGTHS in MealPlanDetail: the plan lengths the app actually offers.
const LENGTHS = [3, 5, 7, 14];

type Status = { kind: "ok" | "error"; text: string } | null;

export default function Settings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [theme, setThemeChoice] = useState<ThemeChoice>(() => getTheme());
  const [nameStatus, setNameStatus] = useState<Status>(null);
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);
  const [prefStatus, setPrefStatus] = useState<Status>(null);
  const [avatarStatus, setAvatarStatus] = useState<Status>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile().then((p) => {
      setProfile(p);
      setName(p.display_name);
    }).catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  // The bucket is private, so the stored path has to be exchanged for a signed URL.
  useEffect(() => {
    const path = profile?.avatar_url;
    if (!path) {
      setAvatarUrl(null);
      return;
    }
    let live = true;
    getAvatarUrl(path).then((url) => {
      if (live) setAvatarUrl(url);
    }).catch(() => {
      if (live) setAvatarUrl(null);
    });
    return () => { live = false; };
  }, [profile?.avatar_url]);

  // Every form on this page reports the same way: the API layer already writes
  // user-facing messages, so show the thrown message verbatim rather than a generic one.
  async function run(
    setStatus: (s: Status) => void,
    work: () => Promise<void>,
    success: string,
  ) {
    setStatus(null);
    setBusy(true);
    try {
      await work();
      setStatus({ kind: "ok", text: success });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  function statusLine(status: Status) {
    if (!status) return null;
    return status.kind === "ok" ? (
      <p className="vault-note" role="status">{status.text}</p>
    ) : (
      <p className="form-error" role="alert">{status.text}</p>
    );
  }

  async function handleAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await run(setAvatarStatus, async () => {
      const path = await uploadAvatar(file);
      setProfile((p) => (p ? { ...p, avatar_url: path } : p));
    }, "Picture updated.");
    // Let the same file be chosen again after a failure.
    e.target.value = "";
  }

  async function handleDeleteAccount() {
    await run(setDeleteStatus, async () => {
      await deleteAccount();
      // replace: the back button must not return to a page of a deleted account.
      navigate("/signin", { replace: true });
    }, "Account deleted.");
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    await run(setNameStatus, async () => {
      const trimmed = name.trim();
      await updateDisplayName(trimmed);
      setName(trimmed);
    }, "Display name saved.");
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    // Validate before calling: changePassword re-authenticates, so a mismatch would
    // otherwise cost a round trip and a wrong-password error.
    if (next !== confirm) {
      setPasswordStatus({ kind: "error", text: "Those passwords do not match." });
      return;
    }
    if (next.length < 8) {
      setPasswordStatus({ kind: "error", text: "Use at least 8 characters." });
      return;
    }
    await run(setPasswordStatus, async () => {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
    }, "Password changed.");
  }

  function handleTheme(choice: ThemeChoice) {
    setThemeChoice(choice);
    setTheme(choice);
  }

  async function savePreference(patch: Preferences, success: string) {
    await run(setPrefStatus, async () => {
      const merged = await updatePreferences(patch);
      setProfile((p) => (p ? { ...p, preferences: merged } : p));
    }, success);
  }

  if (loadError) return <p className="form-error" role="alert">{loadError}</p>;
  if (!profile) return <p className="vault-note">Loading...</p>;

  const prefs = profile.preferences ?? {};

  return (
    <div>
      <h1>Settings</h1>

      <section className="plate panel">
        <h2>Account</h2>
        <div className="settings-field">
          <span className="field-label">Picture</span>
          {avatarUrl
            ? <img className="avatar" src={avatarUrl} alt="Your avatar" />
            : <p className="vault-note">No picture yet.</p>}
          <input type="file" accept="image/*" aria-label="Choose a picture" onChange={handleAvatar} />
        </div>
        {statusLine(avatarStatus)}

        <form onSubmit={handleSaveName}>
          <div className="settings-field">
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy}>Save</button>
        </form>
        {statusLine(nameStatus)}

        <form onSubmit={handleChangePassword}>
          <div className="settings-field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy}>Change password</button>
        </form>
        {statusLine(passwordStatus)}
      </section>

      <section className="plate panel">
        <h2>Preferences</h2>

        <div className="settings-field">
          <span className="field-label" id="theme-label">Theme</span>
          <div className="radio-row" role="radiogroup" aria-labelledby="theme-label">
            {(["system", "light", "dark"] as const).map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name="theme"
                  value={choice}
                  checked={theme === choice}
                  onChange={() => handleTheme(choice)}
                />
                {choice === "system" ? "System" : choice === "light" ? "Light" : "Dark"}
              </label>
            ))}
          </div>
        </div>

        <div className="settings-field">
          <label htmlFor="household-size">Household size</label>
          <input
            id="household-size"
            type="number"
            min="1"
            value={prefs.householdSize ?? ""}
            onChange={(e) => savePreference(
              { householdSize: e.target.value === "" ? undefined : Number(e.target.value) },
              "Household size saved.",
            )}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="default-tab">Start on</label>
          <select
            id="default-tab"
            value={prefs.defaultTab ?? "recipes"}
            onChange={(e) => savePreference(
              { defaultTab: e.target.value as "recipes" | "kitchen" },
              "Start page saved.",
            )}
          >
            <option value="recipes">Recipes</option>
            <option value="kitchen">My Kitchen</option>
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="plan-length">Default plan length</label>
          <select
            id="plan-length"
            value={prefs.defaultPlanLength ?? 7}
            onChange={(e) => savePreference(
              { defaultPlanLength: Number(e.target.value) },
              "Plan length saved.",
            )}
          >
            {LENGTHS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="units">Units</label>
          <select
            id="units"
            value={prefs.units ?? "metric"}
            onChange={(e) => savePreference(
              { units: e.target.value as "metric" | "imperial" },
              "Units saved.",
            )}
          >
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>
          <p className="vault-note">Recipes are shown as they were written. This records how your family prefers to write them.</p>
        </div>

        {statusLine(prefStatus)}
      </section>

      <section className="plate panel">
        <h2>Sign-in methods</h2>
        <IdentitiesPanel />
      </section>

      <section className="plate panel">
        <h2>Family data</h2>
        <FamilyDataPanel />
      </section>

      <section className="plate panel">
        <h2>Danger zone</h2>
        {!confirmingDelete ? (
          <button type="button" onClick={() => setConfirmingDelete(true)}>Delete my account</button>
        ) : (
          <div className="danger-confirm">
            <p>Your recipes stay with your family, listed as written by a former member. Your meal plans are deleted. This cannot be undone.</p>
            <div className="settings-field">
              <label htmlFor="delete-confirm">Type DELETE to confirm</label>
              <input
                id="delete-confirm"
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
              />
            </div>
            <div className="recipe-actions">
              <button
                type="button"
                className="action"
                disabled={deleteText !== "DELETE" || busy}
                onClick={handleDeleteAccount}
              >
                Delete my account
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteText("");
                  setDeleteStatus(null);
                }}
              >
                Cancel
              </button>
            </div>
            {statusLine(deleteStatus)}
          </div>
        )}
      </section>
    </div>
  );
}
