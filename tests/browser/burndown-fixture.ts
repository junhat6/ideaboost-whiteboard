// UI workflow用の合成payload。旧summaryと同値の既知投影を明示し、計算自体はunit/APIで検証。
export function withRebase<
  T extends {
    observations: {
      at: string;
      day: string;
      remainingHours: number;
      estimated?: number;
    }[];
  },
>(data: T) {
  return {
    ...data,
    rebase: {
      policy: "latest-scope-observed-completion-v1",
      observations: data.observations.map((point) => ({
        at: point.at,
        day: point.day,
        remainingHours: point.estimated === 0 ? null : point.remainingHours,
      })),
    },
  };
}
