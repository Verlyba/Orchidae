import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Settings2,
  GraduationCap,
  OctagonX,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  Camera,
  Cpu,
  Wifi,
  Play,
  Square,
  Circle,
  Lock,
  Activity,
  Box,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orchiday — Local Robot Orchestrator" },
      {
        name: "description",
        content:
          "Orchiday — local hierarchical orchestrator for SOarm101 desktop robots. Offline three-model control built on Hugging Face LeRobot.",
      },
    ],
  }),
  component: Orchiday,
});

type Mode = "setup" | "learning";

type SubSkill = { name: string; episodes: number; active?: boolean };
type Macro = { name: string; open: boolean; subs: SubSkill[] };

const initialSkills: Macro[] = [
  {
    name: "Uklidit_stůl",
    open: true,
    subs: [
      { name: "Přisuň_se_ke_kostce", episodes: 42, active: true },
      { name: "Uchop_kostku", episodes: 38 },
      { name: "Přesuň_nad_box", episodes: 27 },
      { name: "Pust_do_boxu", episodes: 31 },
    ],
  },
  {
    name: "Třídit_objekty",
    open: false,
    subs: [
      { name: "Rozpoznej_barvu", episodes: 12 },
      { name: "Umísti_do_zóny", episodes: 8 },
    ],
  },
  {
    name: "Skládání_kostek",
    open: false,
    subs: [
      { name: "Vyrovnej_základnu", episodes: 19 },
      { name: "Polož_vrchol", episodes: 14 },
    ],
  },
];

const terminalLines: Array<{ tag?: string; tagClass?: string; text: string; class?: string }> = [
  { tag: "ORCHIDAY", tagClass: "bg-statusbar text-statusbar-foreground", text: "Booting LeRobot subprocess via QProcess [pid=20481]" },
  { tag: "HF_HOME ", tagClass: "bg-syntax-type/20 text-syntax-type", text: "= /projects/orchiday/.hf_cache  (isolated)" },
  { tag: "BOARD   ", tagClass: "bg-syntax-variable/20 text-syntax-variable", text: "arm_leader  UID=0x4E11A7C2  → ttyACM_alpha   OK" },
  { tag: "BOARD   ", tagClass: "bg-syntax-variable/20 text-syntax-variable", text: "arm_follower UID=0x4E11B093 → ttyACM_beta    OK" },
  { tag: "CAMERA  ", tagClass: "bg-syntax-function/20 text-syntax-function", text: "scene  UUID=cam-9f3a  1280x720 @ 30fps" },
  { tag: "CAMERA  ", tagClass: "bg-syntax-function/20 text-syntax-function", text: "wrist  UUID=cam-2bd1  640x480 @ 30fps" },
  { text: "$ python lerobot/scripts/control_robot.py --robot.type=so100 --control.type=teleoperate", class: "text-foreground" },
  { text: "[control_robot] step=00412  joints=[ 0.124,-1.087, 0.553, 0.014,-0.221, 0.000]  dt=33.2ms", class: "text-muted-foreground" },
  { text: "[control_robot] step=00413  joints=[ 0.131,-1.082, 0.561, 0.018,-0.224, 0.000]  dt=33.1ms", class: "text-muted-foreground" },
  { tag: "LLM/CEO ", tagClass: "bg-syntax-keyword/20 text-syntax-keyword", text: "decompose(\"Uklidit stůl\") → [Přisuň_se_ke_kostce, Uchop_kostku, Přesuň_nad_box, Pust_do_boxu]" },
  { tag: "INJECT  ", tagClass: "bg-syntax-string/25 text-syntax-string", text: "label → \"Přisuň_se_ke_kostce\"   (LeRobot text-conditioning)" },
  { tag: "LATCH   ", tagClass: "bg-destructive/30 text-destructive-foreground", text: "🔒 task locked — suppressing VLM/LLM calls during motor execution" },
  { text: "[control_robot] step=00414  joints=[ 0.139,-1.076, 0.572, 0.025,-0.228, 0.000]  dt=33.0ms", class: "text-muted-foreground" },
  { text: "[control_robot] step=00415  joints=[ 0.148,-1.069, 0.585, 0.033,-0.231, 0.012]  dt=33.4ms", class: "text-muted-foreground" },
  { tag: "LATCH   ", tagClass: "bg-syntax-comment/25 text-syntax-comment", text: "🔓 task released — phase boundary reached" },
  { tag: "VLM     ", tagClass: "bg-syntax-type/20 text-syntax-type", text: "inspect(scene) → success=true  conf=0.91  next=\"Uchop_kostku\"" },
  { tag: "TRAIN   ", tagClass: "bg-syntax-function/20 text-syntax-function", text: "epoch=07/40  loss=0.0427  lr=3.0e-4  grad_norm=0.812" },
];

function Orchiday() {
  const [mode, setMode] = useState<Mode>("learning");
  const [skills, setSkills] = useState(initialSkills);
  const [episodes, setEpisodes] = useState(50);
  const [maxTime, setMaxTime] = useState(45);
  const [recording, setRecording] = useState(false);
  const [latched, setLatched] = useState(true);

  const toggleMacro = (i: number) =>
    setSkills((s) => s.map((m, idx) => (idx === i ? { ...m, open: !m.open } : m)));

  const activeSub = skills.flatMap((m) => m.subs).find((s) => s.active);

  return (
    <div className="flex h-screen w-screen flex-col bg-editor text-foreground">
      {/* Title bar */}
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-sidebar px-3 text-[12px] text-sidebar-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-semibold">
            <Box className="size-3.5 text-syntax-type" />
            Orchiday
          </span>
          <span>File</span>
          <span>Project</span>
          <span>Robot</span>
          <span>Models</span>
          <span>View</span>
          <span>Help</span>
        </div>
        <div className="text-muted-foreground">soarm101_workbench — Orchiday Local Orchestrator</div>
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1">
            <Wifi className="size-3" /> LM Studio :1234
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Activity bar */}
        <nav className="flex w-12 shrink-0 flex-col items-center justify-between bg-activitybar py-2 text-activitybar-foreground">
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setMode("setup")}
              className={`flex size-12 items-center justify-center border-l-2 transition-colors ${
                mode === "setup"
                  ? "border-foreground text-foreground"
                  : "border-transparent hover:text-foreground"
              }`}
              title="Setup"
            >
              <Settings2 className="size-6" strokeWidth={1.3} />
            </button>
            <button
              onClick={() => setMode("learning")}
              className={`flex size-12 items-center justify-center border-l-2 transition-colors ${
                mode === "learning"
                  ? "border-foreground text-foreground"
                  : "border-transparent hover:text-foreground"
              }`}
              title="Učení"
            >
              <GraduationCap className="size-6" strokeWidth={1.3} />
            </button>
          </div>
          <div className="flex flex-col items-center gap-2 pb-1">
            <button
              className="flex size-10 items-center justify-center rounded-sm bg-destructive text-destructive-foreground shadow-[0_0_0_2px_var(--color-destructive)] ring-1 ring-destructive/60 hover:bg-destructive/90"
              title="EMERGENCY STOP — process.kill() LeRobot"
            >
              <OctagonX className="size-7" strokeWidth={1.8} />
            </button>
            <span className="text-[9px] font-bold uppercase tracking-wider text-destructive">
              E-STOP
            </span>
          </div>
        </nav>

        {/* Primary Sidebar */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
          <div className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{mode === "setup" ? "Project Overview" : "Skills Tree"}</span>
            <span className="rounded-sm bg-activitybar px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-foreground">
              {mode === "setup" ? "Setup" : "Učení"}
            </span>
          </div>

          {mode === "setup" ? (
            <div className="flex-1 space-y-3 overflow-auto px-4 py-2 text-[12px]">
              <Row k="Project" v="soarm101_workbench" />
              <Row k="Orchiday" v="v0.4.2" mono />
              <Row k="LeRobot" v="0.1.0-rc4" mono />
              <Row k="HF_HOME" v="./.hf_cache (isolated)" mono />
              <Hr />
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Connections
              </div>
              <Status label="LM Studio" detail="127.0.0.1:1234" ok />
              <Status label="Arm leader" detail="UID 0x4E11A7C2" ok />
              <Status label="Arm follower" detail="UID 0x4E11B093" ok />
              <Status label="Scene cam" detail="cam-9f3a" ok />
              <Status label="Wrist cam" detail="cam-2bd1" ok />
            </div>
          ) : (
            <div className="flex-1 overflow-auto py-1">
              {skills.map((m, i) => (
                <div key={m.name}>
                  <button
                    onClick={() => toggleMacro(i)}
                    className="flex w-full items-center gap-1 px-2 py-[3px] text-left text-[13px] hover:bg-sidebar-accent"
                  >
                    {m.open ? (
                      <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 opacity-70" />
                    )}
                    {m.open ? (
                      <FolderOpen className="size-3.5 shrink-0 text-syntax-function" />
                    ) : (
                      <Folder className="size-3.5 shrink-0 text-syntax-function" />
                    )}
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {m.subs.length}
                    </span>
                  </button>
                  {m.open && (
                    <ul>
                      {m.subs.map((s) => (
                        <li key={s.name}>
                          <button
                            className={`flex w-full items-center gap-1.5 py-[2px] pl-8 pr-2 text-left text-[12.5px] hover:bg-sidebar-accent ${
                              s.active ? "bg-tab-active text-foreground" : ""
                            }`}
                          >
                            <FileCode className="size-3.5 shrink-0 text-syntax-variable" />
                            <span className="truncate">{s.name}</span>
                            <span className="ml-auto rounded-sm bg-activitybar px-1 text-[10px] text-muted-foreground">
                              {s.episodes} ep
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Workspace */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center bg-sidebar text-sm">
            <button
              onClick={() => setMode("setup")}
              className={`flex h-9 items-center gap-2 border-r border-border px-3 text-[13px] ${
                mode === "setup"
                  ? "bg-tab-active text-foreground"
                  : "bg-tab-inactive text-muted-foreground hover:text-foreground"
              }`}
            >
              <Settings2 className="size-3.5 text-syntax-variable" />
              Setup
            </button>
            <button
              onClick={() => setMode("learning")}
              className={`flex h-9 items-center gap-2 border-r border-border px-3 text-[13px] ${
                mode === "learning"
                  ? "bg-tab-active text-foreground"
                  : "bg-tab-inactive text-muted-foreground hover:text-foreground"
              }`}
            >
              <GraduationCap className="size-3.5 text-syntax-variable" />
              Učení
            </button>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 border-b border-border bg-editor px-4 py-1 text-xs text-muted-foreground">
            <span>soarm101_workbench</span>
            <ChevronRight className="size-3" />
            <span>{mode === "setup" ? "configuration" : "skills"}</span>
            <ChevronRight className="size-3" />
            <span className="text-foreground">
              {mode === "setup" ? "hardware.toml" : activeSub?.name ?? "—"}
            </span>
          </div>

          {/* Editor area (top, 55%) */}
          <div className="flex-1 overflow-auto bg-editor">
            {mode === "setup" ? <SetupPanel /> : <LearningPanel
              episodes={episodes}
              setEpisodes={setEpisodes}
              maxTime={maxTime}
              setMaxTime={setMaxTime}
              recording={recording}
              setRecording={setRecording}
              activeSub={activeSub?.name}
            />}
          </div>

          {/* Terminal (bottom, ~45%) */}
          <section className="h-[45%] shrink-0 border-t border-border bg-editor">
            <div className="flex items-center justify-between border-b border-border bg-sidebar pr-3">
              <div className="flex items-center gap-4 px-4 text-[11px] font-semibold uppercase tracking-wider">
                <button className="border-b-2 border-foreground py-2 text-foreground">
                  Terminal
                </button>
                <button className="py-2 text-muted-foreground hover:text-foreground">
                  LeRobot Stream
                </button>
                <button className="py-2 text-muted-foreground hover:text-foreground">
                  Train Loss
                </button>
                <button className="py-2 text-muted-foreground hover:text-foreground">
                  Problems
                </button>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span
                  className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 ${
                    latched
                      ? "bg-destructive/25 text-destructive-foreground"
                      : "bg-syntax-comment/25 text-syntax-comment"
                  }`}
                >
                  <Lock className="size-3" /> {latched ? "TASK LATCHED" : "RELEASED"}
                </span>
                <button
                  onClick={() => setLatched((v) => !v)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  toggle
                </button>
              </div>
            </div>
            <div className="h-[calc(100%-2.5rem)] overflow-auto p-3 font-mono text-[12.5px] leading-[18px]">
              {terminalLines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  {l.tag && (
                    <span className={`shrink-0 rounded-sm px-1.5 text-[10.5px] font-bold leading-[18px] ${l.tagClass}`}>
                      {l.tag}
                    </span>
                  )}
                  <span className={l.class ?? "text-foreground"}>{l.text}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-2">
                <span className="text-syntax-function">orchiday@soarm101</span>
                <span className="text-foreground">:</span>
                <span className="text-syntax-variable">~/workbench</span>
                <span className="text-foreground">$</span>
                <span className="inline-block h-4 w-2 translate-y-[2px] animate-pulse bg-foreground" />
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between bg-statusbar px-3 text-[12px] text-statusbar-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Activity className="size-3.5" /> QProcess: control_robot.py
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="size-3.5" /> 30 FPS
          </span>
          <span className="flex items-center gap-1">
            <Camera className="size-3.5" /> 2 cams
          </span>
          <span className="flex items-center gap-1">
            <Lock className="size-3.5" /> latch:{latched ? "ON" : "OFF"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>LeRobot 0.1.0-rc4</span>
          <span>HF_HOME isolated</span>
          <span>LM Studio ✓</span>
          <span>Orchiday v0.4.2</span>
        </div>
      </footer>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "font-mono text-syntax-variable" : "text-foreground"}>{v}</span>
    </div>
  );
}

function Hr() {
  return <div className="my-2 h-px bg-border" />;
}

function Status({ label, detail, ok }: { label: string; detail: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <Circle
        className={`size-2 fill-current ${ok ? "text-syntax-comment" : "text-destructive"}`}
      />
      <span className="text-foreground">{label}</span>
      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{detail}</span>
    </div>
  );
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        defaultValue={value}
        className={`h-8 rounded-sm border border-border bg-sidebar px-2 text-[12.5px] text-foreground focus:border-ring focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function SetupPanel() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-5">
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Arm Board UIDs
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Leader UID" value="0x4E11A7C2" />
          <Field label="Follower UID" value="0x4E11B093" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Camera UUIDs
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scene camera" value="cam-9f3a-1280x720" />
          <Field label="Wrist camera" value="cam-2bd1-640x480" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Runtime
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Global FPS" value="30" />
          <Field label="HF_HOME" value="./.hf_cache" />
          <Field label="Device" value="cuda:0" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          LM Studio endpoints
        </h2>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field label="LLM (CEO) model" value="qwen2.5-7b-instruct" mono={false} />
            <Field label="Endpoint" value="http://127.0.0.1:1234/v1" />
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field label="VLM (Inspector) model" value="llava-1.6-mistral-7b" mono={false} />
            <Field label="Endpoint" value="http://127.0.0.1:1234/v1" />
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field label="LeRobot policy (Worker)" value="act_so100_real" mono={false} />
            <Field label="Checkpoint dir" value="./.hf_cache/checkpoints/act_so100" />
          </div>
        </div>
      </section>
    </div>
  );
}

function LearningPanel({
  episodes,
  setEpisodes,
  maxTime,
  setMaxTime,
  recording,
  setRecording,
  activeSub,
}: {
  episodes: number;
  setEpisodes: (n: number) => void;
  maxTime: number;
  setMaxTime: (n: number) => void;
  recording: boolean;
  setRecording: (v: boolean) => void;
  activeSub?: string;
}) {
  return (
    <div className="grid h-full grid-cols-[1fr_1fr_minmax(280px,360px)] gap-3 p-3">
      <CameraTile label="Scene stream" sub="cam-9f3a · 1280×720 · 30fps" hue="type" />
      <CameraTile label="Wrist stream" sub="cam-2bd1 · 640×480 · 30fps" hue="variable" />

      {/* Recording panel for active sub-skill */}
      <div className="flex flex-col rounded-sm border border-border bg-sidebar">
        <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recording panel
        </div>
        <div className="flex flex-1 flex-col gap-3 p-3 text-[12.5px]">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Active sub-skill
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <FileCode className="size-3.5 text-syntax-variable" />
              <span className="font-mono text-syntax-variable">{activeSub ?? "—"}</span>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Episodes
            </span>
            <input
              type="number"
              value={episodes}
              onChange={(e) => setEpisodes(Number(e.target.value))}
              className="h-8 rounded-sm border border-border bg-editor px-2 font-mono text-foreground focus:border-ring focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Max time per episode (s)
            </span>
            <input
              type="number"
              value={maxTime}
              onChange={(e) => setMaxTime(Number(e.target.value))}
              className="h-8 rounded-sm border border-border bg-editor px-2 font-mono text-foreground focus:border-ring focus:outline-none"
            />
          </label>

          <div className="mt-auto flex flex-col gap-2">
            <button
              onClick={() => setRecording(!recording)}
              className={`flex h-9 items-center justify-center gap-2 rounded-sm text-[12.5px] font-semibold ${
                recording
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {recording ? (
                <>
                  <Square className="size-3.5 fill-current" /> Stop teleop
                </>
              ) : (
                <>
                  <Play className="size-3.5 fill-current" /> Start teleop
                </>
              )}
            </button>
            <button className="h-8 rounded-sm border border-border text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              Train policy on this sub-skill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CameraTile({
  label,
  sub,
  hue,
}: {
  label: string;
  sub: string;
  hue: "type" | "variable";
}) {
  const hueClass = hue === "type" ? "text-syntax-type" : "text-syntax-variable";
  return (
    <div className="flex flex-col overflow-hidden rounded-sm border border-border bg-sidebar">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground">
          <Camera className={`size-3.5 ${hueClass}`} />
          {label}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground">{sub}</span>
      </div>
      <div className="relative flex flex-1 items-center justify-center bg-[repeating-linear-gradient(45deg,transparent_0_8px,rgba(255,255,255,0.025)_8px_16px)]">
        <div className="absolute inset-2 rounded-sm border border-dashed border-border/60" />
        <div className={`flex flex-col items-center gap-1 ${hueClass}`}>
          <Camera className="size-7" strokeWidth={1.2} />
          <span className="font-mono text-[11px] opacity-80">live · 30fps</span>
        </div>
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-sm bg-destructive/80 px-1.5 text-[10px] font-bold text-destructive-foreground">
          <Circle className="size-1.5 fill-current" /> REC
        </span>
      </div>
    </div>
  );
}
