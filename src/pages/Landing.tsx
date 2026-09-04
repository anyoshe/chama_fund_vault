import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  PiggyBank,
  ShieldCheck,
  UsersFour,
  ChartLineUp,
  ArrowRight,
} from "@phosphor-icons/react";

const features = [
  {
    icon: UsersFour,
    title: "Multi-chama accounts",
    desc: "Every group gets its own secure workspace with members and roles.",
  },
  {
    icon: ShieldCheck,
    title: "Quorum governance",
    desc: "Loans and payouts only move after the group votes — no cash handling.",
  },
  {
    icon: ChartLineUp,
    title: "Live treasury ledger",
    desc: "Track contributions, loans and repayments with a clear audit trail.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/25 via-slate-950 to-slate-950" />

      <header className="relative z-10 border-b border-slate-800/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 shadow-lg shadow-emerald-500/25">
              <PiggyBank size={20} weight="fill" className="text-white" />
            </div>
            <span className="text-sm font-bold tracking-tight text-white">
              Chama<span className="text-emerald-400">Vault</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-500"
            >
              Create chama
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Zero-cash group treasury
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Run your chama like a{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              modern ERP
            </span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">
            Create a chama account, invite members with login credentials, and
            manage contributions, loans and governance — all in one place.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-teal-500"
            >
              Create your chama
              <ArrowRight size={18} weight="bold" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-900"
            >
              Sign in to existing chama
            </Link>
          </div>
        </motion.div>

        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <f.icon size={22} weight="duotone" />
              </div>
              <h3 className="text-sm font-bold text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
