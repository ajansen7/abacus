export type WatchdogReason = 'wallclock_cap' | 'iteration_cap' | 'token_cap';

export interface WatchdogArm {
  cancel(): void;
}

export interface WatchdogArmParams {
  maxWallclockMs: number;
  onBreach: (reason: WatchdogReason) => void | Promise<void>;
}

export class Watchdog {
  arm(params: WatchdogArmParams): WatchdogArm {
    const timer = setTimeout(() => {
      void params.onBreach('wallclock_cap');
    }, params.maxWallclockMs);
    return {
      cancel: () => clearTimeout(timer),
    };
  }
}
