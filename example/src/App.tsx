import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import {
  ICloudError,
  type DocumentInfo,
  type ICloudDiagnostics,
} from '@ltatarev/react-native-icloud';
import { addLogLine, onLogLine, store, type LogLine } from './store';
import { ActionButton, colors, Field, Row, Section, StatusLine } from './ui';

/*
 * A test bed, not a product. Every button calls one store method and writes
 * the result to the log at the bottom. The app uses its own container,
 * `iCloud.com.ltatarev.icloud-example`, so it never touches app data.
 * See example/TESTING.md for the device checklist.
 */

const MAX_LOG_LINES = 300;
const ONE_MB = 1024 * 1024;
const UPLOAD_SOURCE = `${RNFS.DocumentDirectoryPath}/upload-source.txt`;

type Status = {
  isAvailable: boolean | undefined;
  containerPath: string | undefined;
  diagnostics: ICloudDiagnostics | undefined;
};

function describeError(error: unknown): string {
  if (error instanceof ICloudError) {
    return `[${error.code}] ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function describeItem(item: DocumentInfo): string {
  const kind = item.isDirectory ? 'dir' : `${item.size} B`;
  const state = item.isDownloaded ? 'local' : 'placeholder';
  const time = new Date(item.modifiedAt).toLocaleTimeString();
  return `${kind} · ${state} · ${time}`;
}

function formatTime(at: number): string {
  const date = new Date(at);
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toLocaleTimeString()}.${ms}`;
}

function availabilityTone(isAvailable: boolean | undefined) {
  if (isAvailable === undefined) {
    return 'neutral';
  }
  return isAvailable ? 'good' : 'bad';
}

export default function App() {
  const [status, setStatus] = useState<Status>({
    isAvailable: undefined,
    containerPath: undefined,
    diagnostics: undefined,
  });
  const [isIdle, setIsIdle] = useState(store.isIdle());
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [items, setItems] = useState<DocumentInfo[]>([]);
  const [listedDirectory, setListedDirectory] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);

  const [docName, setDocName] = useState('note.json');
  const [docValue, setDocValue] = useState('{"text":"hello"}');
  const [fileName, setFileName] = useState('files/sample.txt');
  const [directory, setDirectory] = useState('');
  const [kvKey, setKvKey] = useState('greeting');
  const [kvValue, setKvValue] = useState('hello');

  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
  const listedDirectoryRef = useRef('');

  useEffect(() => {
    return onLogLine(line => {
      setLog(lines => [line, ...lines].slice(0, MAX_LOG_LINES));
    });
  }, [setLog]);

  // isIdle() is synchronous and has no event, so poll it.
  useEffect(() => {
    const timer = setInterval(() => setIsIdle(store.isIdle()), 250);
    return () => clearInterval(timer);
  }, [setIsIdle]);

  useEffect(() => {
    return () => unsubscribeRef.current?.();
  }, []);

  const run = useCallback(
    async (label: string, action: () => Promise<string | undefined>) => {
      addLogLine('action', `▶ ${label}`);
      try {
        const result = await action();
        addLogLine('action', `✓ ${label}${result ? `: ${result}` : ''}`);
      } catch (error) {
        addLogLine('action', `✗ ${label}: ${describeError(error)}`, true);
      }
    },
    [],
  );

  const refreshStatus = useCallback(
    () =>
      run('Refresh status', async () => {
        const [isAvailable, containerPath, diagnostics] = await Promise.all([
          store.isAvailable().catch(() => false),
          store.getContainerPath().catch(() => undefined),
          store.diagnose(),
        ]);
        setStatus({ isAvailable, containerPath, diagnostics });
        return `available=${isAvailable}, problems=${diagnostics.problems.length}`;
      }),
    [run, setStatus],
  );

  const listItems = useCallback(
    (listDirectory: string) =>
      run(`List "${listDirectory || '/'}"`, async () => {
        const result = await store.list({ directory: listDirectory });
        listedDirectoryRef.current = listDirectory;
        setItems(result);
        setListedDirectory(listDirectory);
        return `${result.length} items`;
      }),
    [run, setItems, setListedDirectory],
  );

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const toggleSubscription = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = undefined;
      setIsSubscribed(false);
      addLogLine('event', 'Unsubscribed');
      return;
    }
    unsubscribeRef.current = store.subscribe(event => {
      addLogLine('event', JSON.stringify(event));
      if (event.type === 'documentsChanged') {
        listItems(listedDirectoryRef.current);
      }
      if (event.type === 'availabilityChanged') {
        refreshStatus();
      }
    });
    setIsSubscribed(true);
    addLogLine('event', 'Subscribed');
  };

  const confirmDeleteAll = () => {
    Alert.alert(
      'Delete all?',
      'This removes every item in the Documents directory and every ' +
        'key-value entry of the example container.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () =>
            run('Delete all', async () => {
              const isDrained = await store.waitUntilIdle(10000);
              await store.deleteAll();
              setItems([]);
              return `writes drained first: ${isDrained}`;
            }),
        },
      ],
    );
  };

  const doc = store.doc(docName);
  const { diagnostics } = status;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}>
      <Text style={styles.title}>iCloud Example</Text>

      <Section title="Status">
        <StatusLine
          label="Supported"
          tone={store.isSupported() ? 'good' : 'bad'}
          value={`${store.isSupported()} (${Platform.OS})`}
        />
        <StatusLine
          label="Available"
          tone={availabilityTone(status.isAvailable)}
          value={String(status.isAvailable ?? 'checking…')}
        />
        <StatusLine
          label="Writes"
          tone={isIdle ? 'good' : 'neutral'}
          value={isIdle ? 'idle' : 'in flight'}
        />
        <StatusLine
          label="Events"
          value={isSubscribed ? 'subscribed' : 'not subscribed'}
        />
        {diagnostics ? (
          <>
            <StatusLine
              label="Signed in"
              tone={diagnostics.isSignedIn ? 'good' : 'bad'}
              value={String(diagnostics.isSignedIn)}
            />
            <StatusLine
              label="Container"
              value={[
                diagnostics.requestedContainer ?? '(first entitlement)',
                diagnostics.containerSource,
                diagnostics.usedFallback ? 'fallback' : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <StatusLine label="Directory" value={diagnostics.directory} />
            <StatusLine
              label="Documents"
              value={String(diagnostics.documentCount ?? 'unknown')}
            />
            <StatusLine
              label="Path"
              value={status.containerPath ?? 'unresolved'}
            />
            <StatusLine
              label="Problems"
              tone={diagnostics.problems.length === 0 ? 'good' : 'bad'}
              value={
                diagnostics.problems.length === 0
                  ? 'none'
                  : diagnostics.problems.join('\n')
              }
            />
          </>
        ) : null}
        <Row>
          <ActionButton label="Refresh status" onPress={refreshStatus} />
          <ActionButton
            label={isSubscribed ? 'Unsubscribe' : 'Subscribe to events'}
            onPress={toggleSubscription}
          />
        </Row>
      </Section>

      <Section title="Documents">
        <Row>
          <Field label="Name" value={docName} onChangeText={setDocName} />
        </Row>
        <Row>
          <Field
            multiline
            label="JSON value"
            value={docValue}
            onChangeText={setDocValue}
          />
        </Row>
        <Row>
          <ActionButton
            label="Write"
            onPress={() =>
              run(`Write "${docName}"`, async () => {
                await doc.write(JSON.parse(docValue));
                return undefined;
              })
            }
          />
          <ActionButton
            label="Read"
            onPress={() =>
              run(`Read "${docName}"`, async () => {
                const value = await doc.read();
                return value === undefined ? 'absent' : JSON.stringify(value);
              })
            }
          />
          <ActionButton
            label="Stat"
            onPress={() =>
              run(`Stat "${docName}"`, async () => {
                const info = await doc.stat();
                return info ? describeItem(info) : 'absent';
              })
            }
          />
          <ActionButton
            label="Stat + download"
            onPress={() =>
              run(`Stat "${docName}" with download`, async () => {
                const info = await doc.stat({ downloadTimeoutMs: 10000 });
                return info ? describeItem(info) : 'absent';
              })
            }
          />
          <ActionButton
            label="Exists"
            onPress={() =>
              run(`Exists "${docName}"`, async () => String(await doc.exists()))
            }
          />
          <ActionButton
            label="Delete"
            onPress={() =>
              run(`Delete "${docName}"`, async () => {
                await doc.delete();
                return undefined;
              })
            }
          />
          <ActionButton
            label="Write 10× at once"
            onPress={() =>
              run(`Write "${docName}" 10 times in parallel`, async () => {
                const writes = Array.from({ length: 10 }, (_, index) =>
                  doc.write({ count: index + 1, at: Date.now() }),
                );
                await Promise.all(writes);
                const value = (await doc.read()) as { count?: number };
                return `last count=${value?.count} (expect 10)`;
              })
            }
          />
        </Row>
      </Section>

      <Section title="Files">
        <Row>
          <Field label="Name" value={fileName} onChangeText={setFileName} />
        </Row>
        <Row>
          <ActionButton
            label="Upload small file"
            onPress={() =>
              run(`Upload "${fileName}"`, async () => {
                const text = `Uploaded at ${new Date().toISOString()}`;
                await RNFS.writeFile(UPLOAD_SOURCE, text, 'utf8');
                await store.files.upload(UPLOAD_SOURCE, fileName);
                return `${text.length} B`;
              })
            }
          />
          <ActionButton
            label="Upload 1 MB file"
            onPress={() =>
              run(`Upload 1 MB "${fileName}"`, async () => {
                await RNFS.writeFile(UPLOAD_SOURCE, 'x'.repeat(ONE_MB), 'utf8');
                await store.files.upload(UPLOAD_SOURCE, fileName);
                return `${ONE_MB} B`;
              })
            }
          />
          <ActionButton
            label="Download"
            onPress={() =>
              run(`Download "${fileName}"`, async () => {
                const target = `${RNFS.TemporaryDirectoryPath}/download-${Date.now()}`;
                const path = await store.files.download(fileName, target);
                if (!path) {
                  return 'absent';
                }
                const stat = await RNFS.stat(path);
                const head = await RNFS.read(path, 60, 0, 'utf8');
                return `${stat.size} B: ${head}`;
              })
            }
          />
          <ActionButton
            label="Exists"
            onPress={() =>
              run(`File exists "${fileName}"`, async () =>
                String(await store.files.exists(fileName)),
              )
            }
          />
          <ActionButton
            label="Delete"
            onPress={() =>
              run(`Delete file "${fileName}"`, async () => {
                await store.files.delete(fileName);
                return undefined;
              })
            }
          />
        </Row>
      </Section>

      <Section title="Key-value store">
        <Row>
          <Field label="Key" value={kvKey} onChangeText={setKvKey} />
          <Field label="Value" value={kvValue} onChangeText={setKvValue} />
        </Row>
        <Row>
          <ActionButton
            label="Set"
            onPress={() =>
              run(`KV set "${kvKey}"`, async () => {
                store.kv.set(kvKey, kvValue);
                return undefined;
              })
            }
          />
          <ActionButton
            label="Get"
            onPress={() =>
              run(
                `KV get "${kvKey}"`,
                async () => store.kv.get(kvKey) ?? 'absent',
              )
            }
          />
          <ActionButton
            label="Remove"
            onPress={() =>
              run(`KV remove "${kvKey}"`, async () => {
                store.kv.remove(kvKey);
                return undefined;
              })
            }
          />
          <ActionButton
            label="Keys"
            onPress={() =>
              run('KV keys', async () => JSON.stringify(store.kv.keys()))
            }
          />
          <ActionButton
            label="Synchronize"
            onPress={() =>
              run('KV synchronize', async () => {
                await store.kv.synchronize();
                return undefined;
              })
            }
          />
        </Row>
      </Section>

      <Section title={`Items in "${listedDirectory || '/'}"`}>
        <Row>
          <Field
            label="Directory (empty = Documents)"
            value={directory}
            onChangeText={setDirectory}
          />
        </Row>
        <Row>
          <ActionButton label="List" onPress={() => listItems(directory)} />
          <ActionButton
            label="Wait until idle"
            onPress={() =>
              run('Wait until idle', async () =>
                String(await store.waitUntilIdle(10000)),
              )
            }
          />
          <ActionButton
            isDestructive
            label="Delete all"
            onPress={confirmDeleteAll}
          />
        </Row>
        {items.length === 0 ? (
          <Text style={styles.muted}>No items. Tap List.</Text>
        ) : (
          items.map(item => (
            <View key={item.name} style={styles.item}>
              <Text selectable style={styles.itemName}>
                {item.name}
              </Text>
              <Text
                style={[
                  styles.muted,
                  !item.isDownloaded && styles.placeholder,
                ]}>
                {describeItem(item)}
              </Text>
            </View>
          ))
        )}
      </Section>

      <Section title="Log">
        <Row>
          <ActionButton label="Clear log" onPress={() => setLog([])} />
        </Row>
        {log.map(line => (
          <Text
            key={line.id}
            selectable
            style={[
              styles.logLine,
              line.kind === 'native' && styles.muted,
              line.kind === 'event' && styles.event,
              line.isError && styles.error,
            ]}>
            {formatTime(line.at)} {line.kind} {line.text}
          </Text>
        ))}
      </Section>
      <View style={styles.bottom} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginHorizontal: 16,
    marginTop: 8,
  },
  muted: {
    color: colors.muted,
    fontSize: 12,
  },
  item: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  itemName: {
    color: colors.text,
    fontSize: 14,
  },
  placeholder: {
    color: colors.accent,
  },
  logLine: {
    color: colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    paddingVertical: 2,
  },
  event: {
    color: colors.good,
  },
  error: {
    color: colors.bad,
  },
  bottom: {
    height: 48,
  },
});
