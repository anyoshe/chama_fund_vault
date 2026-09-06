import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  PiggyBank,
  Eye,
  EyeSlash,
  SpinnerGap,
  UsersFour,
  UserCircle,
} from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { CHAMA_ACTIVITIES, type ChamaActivity } from "@/types/chama";

export default function RegisterChama() {
  const { registerChama } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Admin
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // Chama
  const [chamaName, setChamaName] = useState("");
  const [tagline, setTagline] = useState("");
  const [activities, setActivities] = useState<ChamaActivity[]>([
    "table-banking",
    "member-loans",
  ]);
  const [minContribution, setMinContribution] = useState(5000);

  const toggleActivity = (value: ChamaActivity) => {
    setActivities((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      if (!fullName.trim() || !email.trim() || !password) {
        setError("Please fill in your name, email and password.");
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      setError(null);
      setStep(2);
      return;
    }

    if (activities.length === 0) {
      setError("Select at least one activity that applies to your chama.");
      return;
    }

    setError(null);
    setSubmitting(true);
    const result = await registerChama({
      fullName,
      email,
      phone,
      password,
      chamaName,
      tagline,
      activities,
      minMonthlyContribution: minContribution,
    });
    setSubmitting(false);

    if (result.error) {
      const msg =
        typeof result.error === "string" && result.error.trim() && result.error !== "{}"
          ? result.error
          : "Could not complete registration. Check the details and try again.";
      setError(msg);
      return;
    }
    if (result.needsEmailConfirmation) {
      setCheckEmail(email.trim());
      return;
    }
    // Session ready — go to dashboard (real chama should load)
    navigate("/app", { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-slate-950 to-slate-950" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-lg"
        >
          {/* Brand */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 shadow-lg shadow-emerald-500/30">
              <PiggyBank size={28} weight="fill" className="text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Create your <span className="text-emerald-400">Chama</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Register your group and become the Chairperson
            </p>
          </div>

          {/* Step indicator */}
          <div className="mb-6 flex items-center justify-center gap-3">
            <StepPill active={step === 1} done={step > 1} icon={<UserCircle size={16} />} label="Your account" />
            <div className="h-px w-8 bg-slate-700" />
            <StepPill active={step === 2} done={false} icon={<UsersFour size={16} />} label="Chama details" />
          </div>

          {checkEmail ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 sm:p-8">
              <h2 className="text-lg font-bold text-white">Check your email</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                We created your account for <span className="font-semibold text-emerald-400">{checkEmail}</span>.
                Open the confirmation link in that inbox, then sign in. Your chama will be set up automatically on first login.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 text-sm font-bold text-white"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {step === 1 && (
                <>
                  <Field
                    label="Full name"
                    id="fullName"
                    value={fullName}
                    onChange={setFullName}
                    placeholder="Grace Wanjiru"
                    required
                  />
                  <Field
                    label="Email"
                    id="email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="grace@email.com"
                    required
                  />
                  <Field
                    label="Phone number"
                    id="phone"
                    value={phone}
                    onChange={setPhone}
                    placeholder="+254 712 345 678"
                    hint="Used for login alongside email"
                  />
                  <div>
                    <label
                      htmlFor="password"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Min. 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 pr-12 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
                      >
                        {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <Field
                    label="Chama name"
                    id="chamaName"
                    value={chamaName}
                    onChange={setChamaName}
                    placeholder="Tumaini Women Investment"
                    required
                  />
                  <Field
                    label="Tagline (optional)"
                    id="tagline"
                    value={tagline}
                    onChange={setTagline}
                    placeholder="Hope that compounds"
                  />

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      What does this chama do?
                    </p>
                    <p className="mb-2 text-[11px] text-slate-500">
                      Select all that apply — most groups combine several.
                    </p>
                    <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                      {CHAMA_ACTIVITIES.map((k) => {
                        const selected = activities.includes(k.value);
                        return (
                          <button
                            key={k.value}
                            type="button"
                            onClick={() => toggleActivity(k.value)}
                            className={`rounded-xl border px-3 py-3 text-left transition ${
                              selected
                                ? "border-emerald-500/50 bg-emerald-500/10"
                                : "border-slate-700 bg-slate-950/50 hover:border-slate-600"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                  selected
                                    ? "border-emerald-400 bg-emerald-500 text-white"
                                    : "border-slate-600 bg-transparent text-transparent"
                                }`}
                              >
                                ✓
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-slate-100">{k.label}</p>
                                <p className="text-[11px] text-slate-400">{k.desc}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {activities.length > 0 && (
                      <p className="mt-2 text-[11px] text-emerald-400/90">
                        {activities.length} selected
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="minContribution"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400"
                    >
                      Min. monthly contribution (KES)
                    </label>
                    <input
                      id="minContribution"
                      type="number"
                      min={100}
                      step={100}
                      value={minContribution}
                      onChange={(e) => setMinContribution(Number(e.target.value) || 0)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
                      required
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                {step === 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep(1);
                    }}
                    className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
                  >
                    Back
                  </button>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <SpinnerGap size={18} className="animate-spin" />
                      Creating…
                    </>
                  ) : step === 1 ? (
                    "Continue"
                  ) : (
                    "Create chama & account"
                  )}
                </button>
              </div>
            </form>
          </div>
          )}

          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-emerald-400 transition hover:text-emerald-300"
            >
              Sign in
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function StepPill({
  active,
  done,
  icon,
  label,
}: {
  active: boolean;
  done: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
        active
          ? "bg-emerald-500/15 text-emerald-400"
          : done
            ? "bg-slate-800 text-slate-300"
            : "bg-slate-900 text-slate-500"
      }`}
    >
      {icon}
      {label}
    </div>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  hint,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
      />
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
