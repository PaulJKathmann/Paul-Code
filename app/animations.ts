// app/animations.ts

const isTTY = !!process.stdout.isTTY;

export interface AnimationOptions {
  interval?: number; // ms between frames, default 200
}

export class AnimationController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private frames: string[] = [];
  private lineCount = 0; // how many lines the last frame occupied

  /** Start animating with the given frames. Each frame is a multi-line string. */
  start(frames: string[], options: AnimationOptions = {}): void {
    if (!isTTY || frames.length === 0) return;

    this.stop();
    this.frames = frames;
    this.frameIndex = 0;
    this.lineCount = 0;

    // Render first frame immediately
    this.renderFrame();

    if (frames.length > 1) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        this.renderFrame();
      }, options.interval ?? 200);
    }
  }

  /** Stop animation and clear the rendered area. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearArea();
    this.lineCount = 0;
  }

  /** Check if currently animating. */
  get active(): boolean {
    return this.timer !== null;
  }

  /** Move cursor up N lines and clear each line. */
  private clearArea(): void {
    if (this.lineCount === 0) return;
    // Move up lineCount lines and clear each
    for (let i = 0; i < this.lineCount; i++) {
      process.stdout.write("\x1b[A"); // cursor up
      process.stdout.write("\x1b[2K"); // clear line
    }
    process.stdout.write("\r"); // carriage return
  }

  /** Render the current frame, clearing the previous one first. */
  private renderFrame(): void {
    this.clearArea();
    const frame = this.frames[this.frameIndex];
    const lines = frame.split("\n");
    this.lineCount = lines.length;
    process.stdout.write(frame + "\n");
  }
}

// Singleton for the owl / main animation
export const mainAnimation = new AnimationController();
