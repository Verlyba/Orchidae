/**
 * Builds the exact command line `POST /training/start` would spawn for one
 * training target, so the Learning page's preview cannot drift from what the
 * backend actually runs.
 *
 * This mirrors `LeRobotBridge.start_training()` in
 * `src/orchiday/ai/lerobot_bridge.py` on purpose — same flag order, same
 * `--policy.push_to_hub=false` fallback, same "extra args override a flag of
 * the same name" rule (`_merge_flags`). It used to hard-code the literal
 * string `lerobot-train`, which is not what gets spawned (the backend always
 * runs `<python> -m lerobot.scripts.lerobot_train`), and never showed a
 * `--config_path=… --resume=true` run even when the checkpoint directory made
 * that the actual outcome. Two independent copies of "what will run" is
 * exactly how a preview starts describing a different run than the click
 * produces — see `resolve_training_output()` on the Python side, which both
 * this preview and the real spawn read from (`will_resume` /
 * `training_output_dir` / `resume_config_path` on the training-targets
 * response).
 */

/** One row from `GET /training/targets` — only the fields the command needs. */
export type TrainCmdTarget = {
  slug: string;
  repo_id: string;
  will_resume: boolean;
  training_output_dir: string;
  resume_config_path: string;
};

/** The form fields on the Learning page that shape every checked run. */
export type TrainCmdInputs = {
  pythonExecutable: string;
  policyType: string;
  steps: number;
  batchSize: number;
  saveFreq: number;
  device: string;
  useWandb: boolean;
  extraArgsStr: string;
};

/** The option name of a `--name=value` token, or '' if it is not one — same
 * rule as the backend's `_flag_name`. */
function flagName(arg: string): string {
  if (!arg.startsWith('--')) return '';
  return arg.slice(2).split('=', 1)[0];
}

/** Appends `extra`, replacing any base flag it repeats in place — same as
 * the backend's `_merge_flags` (LeRobot's parser takes the last occurrence,
 * so the echoed command should show the value that actually wins). */
function mergeFlags(cmd: string[], extra: string[]): void {
  for (const arg of extra) {
    const name = flagName(arg);
    if (name) {
      const at = cmd.findIndex(a => flagName(a) === name);
      if (at !== -1) { cmd[at] = arg; continue; }
    }
    cmd.push(arg);
  }
}

/** Best-effort tokenizer for the "extra CLI args" field — splits on
 * whitespace, honoring '...' and "..." quoting. Not a full shlex (no escape
 * sequences), but that is all a single-line preview needs; the backend still
 * does the real parsing with `shlex.split()` when the run is spawned. */
function splitExtraArgs(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** The full command line one target would be spawned with, as a single
 * space-joined string (what the preview displays). */
export function buildTrainCommand(target: TrainCmdTarget, inputs: TrainCmdInputs): string {
  if (target.will_resume) {
    return [
      inputs.pythonExecutable, '-m', 'lerobot.scripts.lerobot_train',
      `--config_path=${target.resume_config_path}`,
      '--resume=true',
    ].join(' ');
  }

  const cmd = [
    inputs.pythonExecutable, '-m', 'lerobot.scripts.lerobot_train',
    `--policy.type=${inputs.policyType}`,
    `--dataset.repo_id=${target.repo_id}`,
    `--steps=${inputs.steps}`,
    `--batch_size=${inputs.batchSize}`,
    `--save_freq=${inputs.saveFreq}`,
    `--job_name=${target.slug}`,
    `--policy.device=${inputs.device}`,
    `--wandb.enable=${inputs.useWandb ? 'true' : 'false'}`,
  ];
  if (target.training_output_dir) cmd.push(`--output_dir=${target.training_output_dir}`);

  mergeFlags(cmd, splitExtraArgs(inputs.extraArgsStr));

  // Mandatory unless the user's own extra args already set it (mirrors the
  // backend's fallback exactly — `push_to_hub=true` needs a hub `repo_id`
  // this form never collects, so leaving it at the LeRobot default would
  // make the run refuse at argument-parsing time).
  if (!cmd.some(a => a.startsWith('--policy.push_to_hub'))) {
    cmd.push('--policy.push_to_hub=false');
  }

  return cmd.join(' ');
}
