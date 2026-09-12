'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  EmberNative,
  isNative,
  type NativeConnectionInfo,
} from '@/lib/native-bridge';

const emptyConnection: NativeConnectionInfo = { url: '', configured: false };

export function NativeConnection() {
  const [native] = useState(isNative);
  const [connection, setConnection] = useState(emptyConnection);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pairingInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const operation = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (native) {
      void EmberNative.getConnection()
        .then((saved) => {
          if (!mounted.current) return;
          setConnection(saved);
          setUrl(saved.url);
        })
        .catch(() => {
          if (mounted.current)
            setError(
              'The saved connection could not be opened. Pair this phone again.',
            );
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        });
    }
    const input = pairingInput.current;
    return () => {
      mounted.current = false;
      if (input) input.value = '';
    };
  }, [native]);

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current || loading) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await EmberNative.configureConnection({
        url: url.trim(),
        token: pairingInput.current?.value ?? '',
      });
      if (!mounted.current) return;
      setConnection(saved);
      setUrl(saved.url);
      setMessage(
        'Connection saved on this phone. Take a photo and tap Identify cigar to try it.',
      );
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'The connection could not be saved. Check the service address and pairing code.',
        );
    } finally {
      if (pairingInput.current) pairingInput.current.value = '';
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function disconnect() {
    if (operation.current || loading) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const cleared = await EmberNative.clearConnection();
      if (!mounted.current) return;
      setConnection(cleared);
      setUrl('');
      setMessage(
        'Connection removed from this phone. Your journal is still here.',
      );
    } catch {
      if (mounted.current)
        setError('The connection could not be removed. Please try again.');
    } finally {
      if (pairingInput.current) pairingInput.current.value = '';
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!native) return null;

  return (
    <section className="settings-section">
      <span className="settings-section-icon">
        <Link2 size={24} strokeWidth={1.5} />
      </span>
      <div>
        <h3>Photo identification.</h3>
        <p>
          {loading
            ? 'Opening your saved connection…'
            : connection.configured
              ? 'A service connection is saved on this phone.'
              : 'Pair this phone with your Ember identification service.'}{' '}
          Your journal works without a connection.
        </p>
        <form onSubmit={save} style={{ marginTop: 16 }}>
          <label className="form-field">
            <span>Service address</span>
            <Input
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-ember-service.example"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={2048}
              disabled={loading || busy}
            />
          </label>
          <label className="form-field" style={{ marginTop: 14 }}>
            <span>Pairing code</span>
            <Input
              ref={pairingInput}
              type="password"
              required
              minLength={32}
              maxLength={256}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                connection.configured
                  ? 'Enter a code to replace this connection'
                  : 'Paste the code from your Ember service'
              }
              disabled={loading || busy}
            />
          </label>
          <p className="field-help">
            Use the Ember pairing code, not an OpenAI API key. Android encrypts
            it on this phone; the app cannot display the saved code.
          </p>
          <div className="settings-actions" style={{ marginTop: 16 }}>
            <button
              className="ember-button primary"
              type="submit"
              disabled={loading || busy}
            >
              {busy ? (
                <LoaderCircle size={16} className="spinning" />
              ) : (
                <ShieldCheck size={16} />
              )}
              Save connection
            </button>
            {(connection.configured || error) && (
              <button
                className="ember-button secondary"
                type="button"
                onClick={disconnect}
                disabled={loading || busy}
              >
                Disconnect
              </button>
            )}
          </div>
        </form>
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        {message && <output aria-live="polite">{message}</output>}
        <p className="field-help">
          When you tap Identify cigar, the selected photo and hint go to the
          service address above, which sends them to OpenAI. Use a service you
          trust. Saving a connection does not test the service or upload a
          photo.
        </p>
      </div>
    </section>
  );
}
