import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void getVersion()
      .then((currentVersion) => {
        if (isMounted) setVersion(currentVersion);
      })
      .catch((error) => {
        console.error("Failed to get version from Tauri:", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return version;
}
