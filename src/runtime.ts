import { execFile } from "node:child_process";

// Side effects that tests replace: waiting, and starting the Spotify desktop app.
export const runtime = {
  sleep: (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),

  // -g keeps Spotify in the background, so the app does not take the screen from the user.
  launchSpotify: (): Promise<boolean> =>
    new Promise((resolve) => {
      if (process.platform !== "darwin") {
        resolve(false);
        return;
      }

      execFile("open", ["-ga", "Spotify"], (error) => {
        resolve(!error);
      });
    }),
};
