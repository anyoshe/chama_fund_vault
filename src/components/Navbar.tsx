import { useState } from "react";
import {
  Bell,
  CaretDown,
  Check,
  CheckCircle,
  Crown,
  PiggyBank,
  SignOut,
  UserCircle,
  UsersFour,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import type { Chama, Member } from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";

interface NavbarProps {
  chamas: Chama[];
  activeChamaId: string;
  members: Member[];
  currentMemberId: string;
  unreadNotifications: number;
  onSwitchChama: (id: string) => void;
  onSwitchMember: (id: string) => void;
  onOpenNotifications: () => void;
  onLogout?: () => void;
  currentUserName?: string;
}

export default function Navbar({
  chamas,
  activeChamaId,
  members,
  currentMemberId,
  unreadNotifications,
  onSwitchChama,
  onSwitchMember,
  onOpenNotifications,
  onLogout,
  currentUserName,
}: NavbarProps) {
  const [chamaOpen, setChamaOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const activeChama = chamas.find((c) => c.id === activeChamaId) ?? chamas[0];
  const currentMember = members.find((m) => m.id === currentMemberId) ?? members[0];

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
              setMemberOpen(false);
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

          {/* Member switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setMemberOpen((v) => !v);
                setChamaOpen(false);
              }}
              className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/80 py-1.5 pl-1.5 pr-2.5 transition hover:border-emerald-500/50"
            >
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{
                  background: `linear-gradient(135deg, hsl(${currentMember.avatarHue} 65% 42%), hsl(${(currentMember.avatarHue + 40) % 360} 70% 30%))`,
                }}
              >
                {currentMember.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-xs font-semibold leading-tight text-slate-100">{currentMember.name}</p>
                <p className="text-[10px] leading-tight text-slate-400">{currentMember.role}</p>
              </div>
              <CaretDown size={13} className={`text-slate-400 transition-transform ${memberOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {memberOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl shadow-black/50"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Simulate member
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Crown size={12} className="text-amber-400" /> role-based voting
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          onSwitchMember(m.id);
                          setMemberOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-800/70 ${
                          m.id === currentMemberId ? "bg-slate-800/50" : ""
                        }`}
                      >
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                          style={{
                            background: `linear-gradient(135deg, hsl(${m.avatarHue} 65% 42%), hsl(${(m.avatarHue + 40) % 360} 70% 30%))`,
                          }}
                        >
                          {m.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-100">
                            {m.name}
                            {m.isCurrentUser && <span className="ml-1.5 text-[10px] font-medium text-emerald-400">(you)</span>}
                          </p>
                          <p className="text-xs text-slate-400">
                            {m.role} · {fmtKsh(m.totalPaid)} saved
                          </p>
                        </div>
                        {m.role === "Treasurer" && <UserCircle size={15} className="text-amber-400" />}
                        {m.id === currentMemberId && <Check size={15} weight="bold" className="text-emerald-400" />}
                      </button>
                    ))}
                  </div>
                  {currentUserName && (
                    <div className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-400">
                      Signed in as <span className="font-semibold text-slate-200">{currentUserName}</span>
                    </div>
                  )}
                  {onLogout && (
                    <button
                      onClick={() => {
                        setMemberOpen(false);
                        onLogout();
                      }}
                      className="flex w-full items-center gap-2 border-t border-slate-800 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/10"
                    >
                      <SignOut size={16} />
                      Sign out
                    </button>
                  )}
                  <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-950/60 px-4 py-2.5 text-[11px] text-slate-500">
                    <CheckCircle size={13} className="text-emerald-500" />
                    Zero cash handled — all rails are STK Push / EFT to group accounts.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}