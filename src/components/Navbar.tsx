import { useState } from "react";
import {
  Bell,
  CaretDown,
  Check,
  Eye,
  EyeSlash,
  PiggyBank,
  SignOut,
  UserCircle,
  UsersFour,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import type { Chama } from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";

interface NavbarProps {
  chamas: Chama[];
  activeChamaId: string;
  unreadNotifications: number;
  onSwitchChama: (id: string) => void;
  onOpenNotifications: () => void;
  onResetPassword: (currentPassword: string, newPassword: string) => Promise<{ error?: string }>;
  onLogout?: () => void;
  currentUserName?: string;
}

export default function Navbar({
  chamas,
  activeChamaId,
  unreadNotifications,
  onSwitchChama,
  onOpenNotifications,
  onResetPassword,
  onLogout,
  currentUserName,
}: NavbarProps) {
  const [chamaOpen, setChamaOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const activeChama = chamas.find((c) => c.id === activeChamaId) ?? chamas[0];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 shadow-lg shadow-emerald-500/25">
            <PiggyBank size={20} weight="fill" className="text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-bold leading-tight tracking-tight text-white">
              Chama<span className="text-emerald-400">Vault</span>
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
              Zero-cash treasury
            </p>
          </div>
        </div>

        {/* Chama switcher */}
        <div className="relative ml-1 sm:ml-4">
          <button
            onClick={() => {
              setChamaOpen((v) => !v);
            }}
            className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-emerald-500/50 hover:bg-slate-800/80"
          >
            <UsersFour size={17} className="text-emerald-400" />
            <span className="max-w-[150px] truncate sm:max-w-[220px]">{activeChama.name}</span>
            <CaretDown size={14} className={`text-slate-400 transition-transform ${chamaOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {chamaOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl shadow-black/50"
              >
                <div className="border-b border-slate-800 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  My Chamas
                </div>
                {chamas.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onSwitchChama(c.id);
                      setChamaOpen(false);
                    }}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-800/70 ${
                      c.id === activeChamaId ? "bg-slate-800/50" : ""
                    }`}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                      <PiggyBank size={15} weight="fill" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-100">{c.name}</p>
                      <p className="text-xs text-slate-400">
                        {c.memberCount} members · {fmtKsh(c.poolBalance)} pool
                      </p>
                    </div>
                    {c.id === activeChamaId && <Check size={16} weight="bold" className="mt-1 text-emerald-400" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Live balance ticker */}
          <div className="hidden items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 md:flex">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">Pool</span>
            <span className="font-mono text-sm font-bold tabular-nums text-emerald-300">
              {fmtKsh(activeChama.poolBalance)}
            </span>
          </div>

          {/* Notifications */}
          <button
            onClick={onOpenNotifications}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/80 text-slate-300 transition hover:border-emerald-500/50 hover:text-white"
            aria-label="Notifications"
          >
            <Bell size={19} />
            {unreadNotifications > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-slate-950">
                {unreadNotifications}
              </span>
            )}
          </button>

          <div className="relative">
            <button
              onClick={() => {
                setAccountOpen((v) => !v);
                setChamaOpen(false);
              }}
              className="flex h-10 items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/80 px-2 transition hover:border-emerald-500/50"
              aria-label="Open account menu"
              aria-expanded={accountOpen}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-xs font-bold text-emerald-300">
                {(currentUserName ?? "Member").split(" ").map((part) => part[0]).slice(0, 2).join("")}
              </div>
              <span className="hidden max-w-40 truncate text-xs font-semibold text-slate-100 sm:block">
                {currentUserName ?? "Member"}
              </span>
              <CaretDown size={13} className={`text-slate-400 transition-transform ${accountOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {accountOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl shadow-black/50"
                >
                  <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
                    <UserCircle size={24} className="text-emerald-400" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Signed in as</p>
                      <p className="truncate text-sm font-semibold text-slate-100">{currentUserName ?? "Member"}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setAccountOpen(false);
                      setPasswordModalOpen(true);
                    }}
                    className="flex w-full items-center gap-2 border-b border-slate-800 px-4 py-3 text-left text-sm font-semibold text-slate-300 transition hover:bg-slate-800/70"
                  >
                    Reset password
                  </button>
                  {onLogout && (
                    <button
                      onClick={() => {
                        setAccountOpen(false);
                        onLogout();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-red-400 transition hover:bg-red-500/10"
                    >
                      <SignOut size={17} />
                      Sign out
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {passwordModalOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex min-h-screen items-center justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.form
              className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onSubmit={async (event) => {
                event.preventDefault();
                setResetError(null);
                if (newPassword !== confirmPassword) {
                  setResetError("New passwords do not match.");
                  return;
                }
                setResetting(true);
                const result = await onResetPassword(currentPassword, newPassword);
                setResetting(false);
                if (result.error) {
                  setResetError(result.error);
                  return;
                }
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setPasswordModalOpen(false);
              }}
            >
              <div>
                <h2 className="text-lg font-bold text-white">Reset password</h2>
                <p className="mt-1 text-xs text-slate-400">Verify your current password before changing it.</p>
              </div>
              <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} visible={showCurrentPassword} onToggle={() => setShowCurrentPassword((value) => !value)} />
              <PasswordField label="New password" value={newPassword} onChange={setNewPassword} visible={showNewPassword} onToggle={() => setShowNewPassword((value) => !value)} minLength={6} />
              <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((value) => !value)} minLength={6} />
              {resetError && <p className="text-sm text-red-400">{resetError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPasswordModalOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button>
                <button type="submit" disabled={resetting} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{resetting ? "Saving..." : "Save password"}</button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  minLength?: number;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        required
        minLength={minLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 pr-10 text-sm text-slate-100 outline-none focus:border-emerald-500"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-200"
      >
        {visible ? <EyeSlash size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}