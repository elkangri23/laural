import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModalShell } from "./ModalShell";
import { removeHistoryVersion, runAccountActionWhenAllowed, runAccountActionWithSnapshot } from "../accountActionGuards";
import { useLanguage } from "../i18n";

type AuthStatus = { status: "waiting" | "signed_in" | "error"; message: string };
type Preferences = { themeId: string; appearance: "dark" | "light"; updateMode: "manual" | "automatic"; language: "es" | "en" };
type Snapshot = {
  schemaVersion: number;
  preferences: Preferences;
  activeProviderId: string | null;
  providers: { id: string; kind: string; name: string; model: string; customEndpoint?: string }[];
};
type Remote = { snapshot: Snapshot | null; revision: number };
type HistoryPage = { entries: { revision: number; createdAt: string }[]; nextBefore: number | null };
type AccountSession = { id: string; createdAt: string; expiresAt: string; current: boolean };
type AccountMfaStatus = { totpEnabled: boolean; recoveryCodesRemaining: number; enrollmentPending: boolean };
type TotpEnrollment = { secret: string; provisioningUri: string };
type ImportResult = { preferences: Preferences; activeProvider: { id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean } | null; providers: { id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean }[]; backupPath: string; backupEncrypted: boolean; backupContainsApiKeys: boolean };

export function AccountSettings({ onClose, preferences, onImported, onSyncSettled, syncRiskAcknowledged, onAcknowledgeSyncRisk }: { onClose: () => void; preferences: Preferences; onImported: (result: ImportResult) => void; onSyncSettled: () => void; syncRiskAcknowledged: boolean; onAcknowledgeSyncRisk: () => boolean }) {
  const { language, messages } = useLanguage();
  const accountText = messages.account;
  const feedback = accountText.feedback;
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [message, setMessage] = useState(feedback.checkingSession);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [riskChecked, setRiskChecked] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(syncRiskAcknowledged);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsMessage, setSessionsMessage] = useState("");
  const [mfaStatus, setMfaStatus] = useState<AccountMfaStatus | null>(null);
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryAction, setRecoveryAction] = useState<"enrollment" | "rotation" | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [mfaMessage, setMfaMessage] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteCleanupPending, setDeleteCleanupPending] = useState(false);

  useEffect(() => setRiskAcknowledged(syncRiskAcknowledged), [syncRiskAcknowledged]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AuthStatus>("account-auth-status", ({ payload }) => {
      if (disposed) return;
      setBusy(payload.status === "waiting");
      if (payload.status === "signed_in") {
        setConnected(true);
        void loadAccountSessions();
        void loadAccountMfa();
        void loadPasskeysAvailability();
        window.dispatchEvent(new Event("laural:account-connected"));
      }
      setMessage(payload.message);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else {
        unlisten = stopListening;
        setListenerReady(true);
      }
    }).catch(() => {
      if (!disposed) setMessage(feedback.loginListenerFailed);
    });

    void invoke<boolean>("account_session_status").then((hasSession) => {
      if (!disposed) {
        setConnected(hasSession);
        setMessage(hasSession ? feedback.sessionStored : feedback.noAccount);
        setSessionReady(true);
        if (hasSession) {
          void loadAccountSessions();
          void loadAccountMfa();
          void loadPasskeysAvailability();
        }
      }
    }).catch(() => {
      if (!disposed) {
        setMessage(feedback.secureStoreFailed);
        setSessionReady(true);
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function beginLogin() {
    setBusy(true);
    setMessage(feedback.openingBrowser);
    try {
      await invoke("start_account_login");
    } catch {
      setBusy(false);
      setMessage(feedback.browserFailed);
    }
  }

  async function loadAccountSessions() {
    setSessionsMessage(feedback.loadingSessions);
    try {
      const result = await invoke<AccountSession[]>("list_account_sessions");
      if (!Array.isArray(result)) throw new Error("Invalid sessions response");
      setSessions(result);
      setSessionsMessage(result.length ? "" : feedback.noActiveSessions);
    } catch {
      setSessionsMessage(feedback.sessionsFailed);
    }
  }

  async function loadAccountMfa() {
    try {
      setMfaStatus(await invoke<AccountMfaStatus>("get_account_mfa_status"));
    } catch {
      setMfaStatus(null);
      setMfaMessage(feedback.accountSecurityFailed);
    }
  }

  async function loadPasskeysAvailability() {
    try {
      setPasskeysEnabled(await invoke<boolean>("get_account_passkeys_enabled"));
    } catch {
      setPasskeysEnabled(false);
    }
  }

  async function managePasskeys() {
    setBusy(true);
    try {
      await invoke("start_passkey_management");
      setMfaMessage(feedback.passkeysOpened);
    } catch (error) {
      setMfaMessage(typeof error === "string" ? error : feedback.passkeysFailed);
    } finally {
      setBusy(false);
    }
  }

  async function startTotpEnrollment() {
    setBusy(true);
    setMfaMessage("");
    try {
      setEnrollment(await invoke<TotpEnrollment>("start_totp_enrollment"));
      setRecoveryCodes([]);
      setRecoveryAction(null);
      setMfaCode("");
    } catch {
      setMfaMessage(feedback.totpStartFailed);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotpEnrollment() {
    setBusy(true);
    setMfaMessage("");
    try {
      setRecoveryCodes(await invoke<string[]>("confirm_totp_enrollment", { code: mfaCode }));
      setRecoveryAction("enrollment");
      setRecoverySaved(false);
      setMfaCode("");
    } catch {
      setMfaMessage(feedback.totpCodeInvalid);
    } finally {
      setBusy(false);
    }
  }

  async function rotateRecoveryCodes() {
    setBusy(true);
    setMfaMessage("");
    try {
      setRecoveryCodes(await invoke<string[]>("rotate_account_recovery_codes"));
      setRecoveryAction("rotation");
      setRecoverySaved(false);
    } catch {
      setMfaMessage(feedback.recoveryRenewFailed);
    } finally {
      setBusy(false);
    }
  }

  async function finishRecoveryCodes() {
    await runAccountActionWhenAllowed(recoverySaved, async () => {
      setBusy(true);
      setMfaMessage("");
      try {
        await invoke("complete_totp_enrollment");
        setEnrollment(null);
        setRecoveryCodes([]);
        setRecoveryAction(null);
        await loadAccountMfa();
        await loadAccountSessions();
        setMfaMessage(recoveryAction === "rotation" ? feedback.recoveryRotated : feedback.totpEnabled);
      } catch {
        setMfaMessage(feedback.totpConfirmFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  async function cancelTotpEnrollment() {
    setBusy(true);
    try {
      await invoke("cancel_totp_enrollment");
      setEnrollment(null);
      setRecoveryCodes([]);
      setRecoveryAction(null);
      setRecoverySaved(false);
      await loadAccountMfa();
    } catch {
      setMfaMessage(feedback.totpCancelFailed);
    } finally {
      setBusy(false);
    }
  }

  async function disableTotp() {
    if (!window.confirm(accountText.disableTotpConfirm)) return;
    setBusy(true);
    try {
      await invoke("disable_account_totp");
      setMfaMessage(feedback.totpDisabled);
      await loadAccountMfa();
      await loadAccountSessions();
    } catch {
      setMfaMessage(feedback.totpDisableFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setMfaMessage(feedback.recoveryCopied);
    } catch {
      setMfaMessage(feedback.recoveryCopyFailed);
    }
  }

  async function revokeAccountSession(session: AccountSession) {
    if (session.current || !window.confirm(accountText.revokeSessionConfirm)) return;
    setBusy(true);
    try {
      const revoked = await invoke<boolean>("revoke_account_session", { sessionId: session.id });
      if (!revoked) {
        setSessionsMessage(feedback.sessionInactive);
        return;
      }
      setSessions((current) => current.filter(({ id }) => id !== session.id));
      setSessionsMessage(feedback.sessionRevoked);
    } catch {
      setSessionsMessage(feedback.sessionRevokeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm(accountText.revokeOtherSessionsConfirm)) return;
    setBusy(true);
    try {
      const revoked = await invoke<number>("revoke_other_account_sessions");
      await loadAccountSessions();
      setSessionsMessage(revoked === 1
        ? feedback.oneSessionRevoked
        : feedback.multipleSessionsRevoked.replace("{count}", String(revoked)));
    } catch {
      setSessionsMessage(feedback.otherSessionsRevokeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function removeLocalSession() {
    setBusy(true);
    try {
      const remotelyRevoked = await invoke<boolean>("clear_account_session");
      setConnected(false);
      setMfaStatus(null);
      setEnrollment(null);
      setRecoveryCodes([]);
      window.dispatchEvent(new Event("laural:account-disconnected"));
      setMessage(remotelyRevoked ? feedback.signedOutConfirmed : feedback.signedOutUnconfirmed);
    } catch {
      setMessage(feedback.signOutFailed);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    await runAccountActionWhenAllowed(deleteConfirmation === "ELIMINAR", async () => {
      if (!window.confirm(accountText.deleteAccountConfirm)) return;
      setBusy(true);
      setDeleteMessage("");
      try {
        const result = await invoke<{ sessionCredentialCleared: boolean; syncStateCleared: boolean }>("delete_account", { confirmation: deleteConfirmation });
        setConnected(false);
        setSessions([]);
        setMfaStatus(null);
        setEnrollment(null);
        setRecoveryCodes([]);
        setDeleteConfirmation("");
        window.dispatchEvent(new Event("laural:account-disconnected"));
        setDeleteCleanupPending(!result.sessionCredentialCleared || !result.syncStateCleared);
        setDeleteMessage(result.sessionCredentialCleared && result.syncStateCleared
          ? feedback.accountDeleted
          : feedback.accountDeletedCleanupPending);
      } catch (error) {
        setDeleteMessage(typeof error === "string" ? error : feedback.accountDeleteFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  async function retryDeletedAccountCleanup() {
    setBusy(true);
    try {
      const result = await invoke<{ sessionCredentialCleared: boolean; syncStateCleared: boolean }>("clear_deleted_account_local_data");
      const pending = !result.sessionCredentialCleared || !result.syncStateCleared;
      setDeleteCleanupPending(pending);
      setDeleteMessage(pending ? feedback.cleanupPending : feedback.cleanupComplete);
    } catch {
      setDeleteMessage(feedback.cleanupFailed);
    } finally {
      setBusy(false);
    }
  }

  function snapshotPreferences(): Preferences {
    return {
      themeId: localStorage.getItem("laural.theme") ?? preferences.themeId,
      appearance: localStorage.getItem("laural.appearance") === "light" ? "light" : "dark",
      updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
      language,
    };
  }

  async function readLocalSnapshot() {
    return invoke<Snapshot>("get_preference_snapshot", { preferences: snapshotPreferences() });
  }

  async function refreshComparison() {
    await runAccountActionWhenAllowed(riskAcknowledged, async () => {
      setBusy(true);
      setRemote(null);
      try {
        const [local, cloud] = await Promise.all([
          readLocalSnapshot(),
          invoke<Remote>("read_remote_preferences"),
        ]);
        setRemote(cloud);
        setHasConflict(Boolean(cloud.snapshot && !snapshotsMatch(local, cloud.snapshot)));
        if (!cloud.snapshot) setMessage(feedback.cloudEmpty);
        else if (snapshotsMatch(local, cloud.snapshot)) {
          const confirmed = await invoke<boolean>("confirm_remote_preferences", { snapshot: local, revision: cloud.revision });
          if (!confirmed) {
            setRemote(null);
            setMessage(feedback.cloudChanged);
            return;
          }
          onSyncSettled();
          setMessage(feedback.settingsMatch);
        }
        else setMessage(feedback.settingsDiffer);
      } catch (error) {
        setMessage(typeof error === "string" ? error : feedback.syncCheckFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  async function keepLocal() {
    await runAccountActionWhenAllowed(riskAcknowledged, async () => {
      setBusy(true);
      setMessage(feedback.savingLocal);
      try {
        const local = await readLocalSnapshot();
        const result = await invoke<{ status: "saved" | "conflict"; revision?: number }>("write_remote_preferences", { snapshot: local, revision: remote!.revision });
        if (result.status === "conflict") {
          setMessage(feedback.cloudChangedSinceCheck);
          setRemote(null);
          setHasConflict(false);
        } else {
          setRemote({ snapshot: local, revision: result.revision ?? remote!.revision + 1 });
          setHasConflict(false);
          onSyncSettled();
          setMessage(feedback.localSynced);
        }
      } catch (error) {
        setMessage(typeof error === "string" ? error : feedback.localSyncFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  async function keepCloud() {
    const cloud = remote;
    await runAccountActionWithSnapshot(riskAcknowledged, cloud?.snapshot, async (snapshot) => {
      setBusy(true);
      setMessage(feedback.applyingCloud);
      try {
        const result = await invoke<ImportResult & { backupPath: string }>("apply_remote_preference_snapshot", {
          snapshot,
          revision: cloud!.revision,
          currentPreferences: snapshotPreferences(),
        });
        onImported(result);
        setHasConflict(false);
        onSyncSettled();
        setMessage(feedback.cloudApplied.replace("{path}", result.backupPath));
      } catch (error) {
        setMessage(typeof error === "string" ? error : feedback.cloudApplyFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  async function loadHistory(before?: number) {
    await runAccountActionWhenAllowed(riskAcknowledged, async () => {
      setBusy(true);
      try {
        const page = await invoke<HistoryPage>("read_remote_preference_history", { beforeRevision: before ?? null });
        setHistory((previous) => before && previous
          ? { entries: [...previous.entries, ...page.entries], nextBefore: page.nextBefore }
          : page);
      } catch (error) {
        setMessage(typeof error === "string" ? error : feedback.historyFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  async function restoreHistoryVersion(version: { revision: number; createdAt: string }) {
    if (!riskAcknowledged || !window.confirm(accountText.restoreConfirm.replace("{revision}", String(version.revision)))) return;
    setBusy(true);
    setMessage(feedback.restoring);
    let cloudRestored = false;
    try {
      const current = await invoke<Remote>("read_remote_preferences");
      if (!current.snapshot) throw new Error(feedback.cloudEmptyRestore);
      const restored = await invoke<Remote>("restore_remote_preference_history", {
        revision: version.revision,
        currentRevision: current.revision,
      });
      cloudRestored = true;
      if (!restored.snapshot) throw new Error(feedback.emptyRestoredVersion);
      const applied = await invoke<ImportResult>("apply_remote_preference_snapshot", {
        snapshot: restored.snapshot,
        revision: restored.revision,
        currentPreferences: snapshotPreferences(),
      });
      onImported(applied);
      onSyncSettled();
      setRemote(restored);
      setHasConflict(false);
      setMessage(feedback.historyRestored.replace("{revision}", String(version.revision)).replace("{newRevision}", String(restored.revision)).replace("{path}", applied.backupPath));
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : feedback.localApplyFailed;
      setMessage(cloudRestored
        ? feedback.cloudRestoredLocalFailed.replace("{detail}", detail)
        : detail);
    } finally {
      setBusy(false);
    }
  }

  async function deleteHistoryVersion(version: { revision: number; createdAt: string }) {
    if (!window.confirm(accountText.deleteVersionConfirm.replace("{revision}", String(version.revision)))) return;
    setBusy(true);
    try {
      await invoke("delete_remote_preference_history", { revision: version.revision });
      setHistory((current) => removeHistoryVersion(current, version.revision));
      setMessage(feedback.historyVersionDeleted.replace("{revision}", String(version.revision)));
    } catch (error) {
      setMessage(typeof error === "string" ? error : feedback.historyDeleteFailed);
    } finally {
      setBusy(false);
    }
  }

  return <ModalShell onClose={onClose} title={accountText.title}>
    <section className="account-settings" aria-labelledby="account-settings-title">
      <p className="eyebrow">{accountText.eyebrow}</p>
      <h3 id="account-settings-title">{accountText.title}</h3>
      <p className="dialog-copy">{accountText.introduction}</p>
      <div className="sync-risk-notice" role="note" aria-label={accountText.riskLabel}>
        <strong>{accountText.riskTitle}</strong>
        <p>{accountText.riskDetails}</p>
        {riskAcknowledged
          ? <p className="sync-risk-accepted">{accountText.riskAccepted}</p>
          : <>
            <label><input type="checkbox" checked={riskChecked} onChange={(event) => setRiskChecked(event.currentTarget.checked)} /> {accountText.riskCheckbox}</label>
            <button className="secondary-button" disabled={!riskChecked} onClick={() => {
              if (onAcknowledgeSyncRisk()) setRiskAcknowledged(true);
              else setMessage(feedback.syncRiskSaveFailed);
            }}>{accountText.enableSync}</button>
          </>}
      </div>
      <p className="form-message" role="status" aria-live="polite">{message}</p>
      {connected
        ? <>
          <div className="account-sync-actions">
            <button className="primary-button" onClick={() => void refreshComparison()} disabled={busy || !riskAcknowledged}>{accountText.syncNow}</button>
            {remote && <>
              {remote.snapshot && hasConflict && <button className="secondary-button" onClick={() => void keepLocal()} disabled={busy || !riskAcknowledged}>{accountText.keepLocal}</button>}
              {remote.snapshot && hasConflict && <button className="secondary-button" onClick={() => void keepCloud()} disabled={busy || !riskAcknowledged}>{accountText.keepCloud}</button>}
              {!remote.snapshot && <button className="secondary-button" onClick={() => void keepLocal()} disabled={busy || !riskAcknowledged}>{accountText.uploadLocal}</button>}
            </>}
          </div>
          <button className="secondary-button" onClick={() => void removeLocalSession()} disabled={busy}>{accountText.removeAccount}</button>
          <section className="account-sessions" aria-labelledby="preference-history-title">
            <div className="account-sessions-heading">
              <h4 id="preference-history-title">{accountText.history}</h4>
              <button className="secondary-button" onClick={() => void loadHistory()} disabled={busy || !riskAcknowledged}>{accountText.refresh}</button>
            </div>
            <p className="dialog-copy">{accountText.historyRetention}</p>
            {history?.entries.length === 0 && <p className="dialog-copy">{accountText.noHistory}</p>}
            {history && history.entries.length > 0 && <ul className="account-session-list">
              {history.entries.map((version) => <li key={version.revision}>
                <div><strong>{accountText.version.replace("{revision}", String(version.revision))}</strong><span>{new Date(version.createdAt).toLocaleString(language)}</span></div>
                <button className="secondary-button" onClick={() => void restoreHistoryVersion(version)} disabled={busy}>{accountText.restore}</button>
                <button className="secondary-button" onClick={() => void deleteHistoryVersion(version)} disabled={busy}>{accountText.delete}</button>
              </li>)}
            </ul>}
            {history?.nextBefore !== null && history?.nextBefore !== undefined && <button className="secondary-button" onClick={() => void loadHistory(history.nextBefore!)} disabled={busy}>{accountText.previousVersions}</button>}
          </section>
          <div className="account-sessions" aria-labelledby="account-sessions-title">
            <div className="account-sessions-heading">
              <h4 id="account-sessions-title">{accountText.sessions}</h4>
              <button className="secondary-button" onClick={() => void loadAccountSessions()} disabled={busy}>{accountText.refresh}</button>
            </div>
            <button className="secondary-button" onClick={() => void revokeOtherSessions()} disabled={busy}>{accountText.revokeOtherSessions}</button>
            {sessionsMessage && <p className="dialog-copy" role="status" aria-live="polite">{sessionsMessage}</p>}
            {sessions.length > 0 && <ul className="account-session-list">
              {sessions.map((session) => <li key={session.id}>
                <div>
                  <strong>{session.current ? accountText.thisDevice : accountText.anotherSignIn}</strong>
                  <span>{accountText.started}: {new Date(session.createdAt).toLocaleString(language)}</span>
                  <span>{accountText.expires}: {new Date(session.expiresAt).toLocaleString(language)}</span>
                </div>
                {!session.current && <button className="secondary-button" onClick={() => void revokeAccountSession(session)} disabled={busy}>{accountText.revoke}</button>}
              </li>)}
            </ul>}
          </div>
          <section className="account-mfa" aria-labelledby="account-mfa-title">
            {passkeysEnabled && <section aria-labelledby="account-passkeys-title">
              <h4 id="account-passkeys-title">{accountText.passkeys}</h4>
              <p className="dialog-copy">{accountText.passkeysInfo}</p>
              <button className="secondary-button" disabled={busy} onClick={() => void managePasskeys()}>{accountText.managePasskeys}</button>
            </section>}
            <h4 id="account-mfa-title">{accountText.mfa}</h4>
            <p className="dialog-copy">{accountText.mfaInfo}</p>
            {mfaMessage && <p className="form-message" role="status" aria-live="polite">{mfaMessage}</p>}
            {!mfaStatus && <p className="dialog-copy">{accountText.checkingSecurity}</p>}
            {mfaStatus && !enrollment && recoveryCodes.length === 0 && <>
              <p className="account-mfa-status">{accountText.status}: <strong>{mfaStatus.totpEnabled ? accountText.enabled : accountText.disabled}</strong>{mfaStatus.totpEnabled && ` ${accountText.availableCodes.replace("{count}", String(mfaStatus.recoveryCodesRemaining))}`}</p>
              {mfaStatus.enrollmentPending && !mfaStatus.totpEnabled && <p className="dialog-copy">{accountText.pendingSetup}</p>}
              {!mfaStatus.totpEnabled
                ? <div className="account-sync-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => void startTotpEnrollment()}>{mfaStatus.enrollmentPending ? accountText.restartSetup : accountText.setupTotp}</button>
                  {mfaStatus.enrollmentPending && <button className="secondary-button" disabled={busy} onClick={() => void cancelTotpEnrollment()}>{accountText.cancelPending}</button>}
                </div>
                : <div className="account-sync-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => void rotateRecoveryCodes()}>{accountText.renewCodes}</button>
                  <button className="secondary-button" disabled={busy} onClick={() => void disableTotp()}>{accountText.disableTotp}</button>
                </div>}
            </>}
            {enrollment && recoveryCodes.length === 0 && <div className="account-mfa-enrollment">
              <p>{accountText.enrollmentInstruction}</p>
              <label>{accountText.setupUri}<input readOnly value={enrollment.provisioningUri} /></label>
              <label>{accountText.manualKey}<input readOnly value={enrollment.secret} /></label>
              <label>{accountText.sixDigitCode}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.currentTarget.value.replace(/\D/gu, "").slice(0, 6))} /></label>
              <div className="account-sync-actions">
                <button className="secondary-button" disabled={busy || mfaCode.length !== 6} onClick={() => void confirmTotpEnrollment()}>{accountText.verifyShowCodes}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void cancelTotpEnrollment()}>{accountText.cancel}</button>
              </div>
            </div>}
            {recoveryCodes.length > 0 && <div className="account-recovery-codes">
              <p>{recoveryAction === "rotation" ? accountText.saveNewCodes : accountText.saveCodesOnce}</p>
              <pre aria-label={accountText.recoveryCodes}>{recoveryCodes.join("\n")}</pre>
              <button className="secondary-button" disabled={busy} onClick={() => void copyRecoveryCodes()}>{accountText.copyCodes}</button>
              <label className="account-recovery-confirm"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.currentTarget.checked)} /> {accountText.savedCodes}</label>
              <div className="account-sync-actions">
                <button className="primary-button" disabled={busy || !recoverySaved} onClick={() => void finishRecoveryCodes()}>{accountText.confirm} {recoveryAction === "rotation" ? accountText.rotate : accountText.activateTotp}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void cancelTotpEnrollment()}>{accountText.cancel}</button>
              </div>
            </div>}
          </section>
        </>
        : <button className="primary-button" onClick={() => void beginLogin()} disabled={busy || !listenerReady || !sessionReady}>{busy ? accountText.waitingBrowser : accountText.signIn}</button>}
      {connected && <p className="dialog-copy account-note">{accountText.syncNotes}</p>}
      {connected && <p className="dialog-copy account-note">{accountText.removeAccountNote}</p>}
      {connected && <section className="account-delete" aria-labelledby="account-delete-title">
        <h4 id="account-delete-title">{accountText.deleteAccount}</h4>
        <p className="dialog-copy">{accountText.deleteDescription} <strong>{accountText.deleteToken}</strong>.</p>
        <div className="account-sync-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void beginLogin()}>{accountText.signInAgain}</button>
        </div>
        <label>{accountText.typeDelete}<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.currentTarget.value)} autoComplete="off" maxLength={8} /></label>
        <button className="danger-button" disabled={busy || deleteConfirmation !== accountText.deleteToken} onClick={() => void deleteAccount()}>{accountText.deleteForever}</button>
      </section>}
      {deleteMessage && <p className="form-message" role="status" aria-live="polite">{deleteMessage}</p>}
      {deleteCleanupPending && <button className="secondary-button" disabled={busy} onClick={() => void retryDeletedAccountCleanup()}>{accountText.retryCleanup}</button>}
    </section>
  </ModalShell>;
}

function snapshotsMatch(left: Snapshot, right: Snapshot) {
  return JSON.stringify(normalizeSnapshot(left)) === JSON.stringify(normalizeSnapshot(right));
}

function normalizeSnapshot(snapshot: Snapshot) {
  return {
    ...snapshot,
    providers: [...snapshot.providers].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
