import { useEffect, useState } from 'preact/hooks';
import { isFingerprintAvailable } from '../security/fingerprint';

/** Whether this phone can unlock with a fingerprint: `undefined` while that is being asked, then true or false. Laptops are false. */
export function useFingerprintAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean>();
  useEffect(() => {
    let current = true;
    void isFingerprintAvailable().then((ok) => {
      if (current) setAvailable(ok);
    });
    return () => {
      current = false;
    };
  }, []);
  return available;
}
