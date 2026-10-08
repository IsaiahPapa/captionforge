const { spawn } = require("node:child_process");

class ProcessError extends Error {
  constructor(command, code, signal, stderr) {
    const outcome = signal ? `was terminated by ${signal}` : `exited with code ${code}`;
    super(`${command} ${outcome}: ${stderr.trim() || "No error output"}`);
    this.name = "ProcessError";
    this.code = code;
    this.signal = signal;
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      stdout += value;
      options.onStdout?.(value);
    });
    child.stderr.on("data", (chunk) => {
      const value = chunk.toString();
      stderr += value;
      options.onStderr?.(value);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      options.signal?.removeEventListener("abort", abort);
      if (code === 0) resolve({ stdout, stderr });
      else if (options.signal?.aborted) reject(new Error("Job cancelled"));
      else reject(new ProcessError(command, code, signal, stderr));
    });

    function abort() {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1500).unref();
    }
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}

module.exports = { runProcess, ProcessError };
