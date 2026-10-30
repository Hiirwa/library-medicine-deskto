import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { native, type NetworkStatus } from '../lib/native';

/** Online = the Rust monitor can reach the server (not just "Wi-Fi is on"). */
export function useNetwork() {
  const [status, setStatus] = useState<NetworkStatus>({ online: navigator.onLine, server: '' });
  useEffect(() => {
    let off: (() => void) | undefined;
    native.networkStatus().then(setStatus).catch(() => {});
    listen<NetworkStatus>('network-status', (e) => setStatus(e.payload)).then((u) => { off = u; });
    // the OS noticed a change: ask the monitor straight away instead of waiting for its next check
    const poke = () => { native.checkNetwork().then(setStatus).catch(() => {}); };
    window.addEventListener('online', poke);
    window.addEventListener('offline', poke);
    return () => { off?.(); window.removeEventListener('online', poke); window.removeEventListener('offline', poke); };
  }, []);
  return status;
}
