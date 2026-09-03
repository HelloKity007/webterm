import { useState } from 'react';

interface Props { fontSize?: number; columns?: number; opacity?: number; radial?: boolean; }

const words = [
  '$', 'ls', '-la', 'cd', '~/', 'ssh', 'root@', 'sftp', 'GET', '/api',
  'SQL', 'SELECT', 'DB', 'docker', 'ps', 'npm', 'run', 'curl', '-X',
  'git', 'push', 'clone', 'grep', '-r', 'cat', '/var/log', 'ip', 'addr',
  'scp', '-P', '2222', 'nano', 'vim', 'htop', 'df', '-h', 'du', '-sh',
  'chmod', '+x', 'systemctl', 'restart', 'kubectl', 'apply', 'make',
  'deploy', '>>', '|', '>', '| >', '/dev/null', '2>&1', '&&',
  '/root', '[ok]',
  './configure', '--prefix', 'wget', 'tar', '-xzf',
  '200', '200 OK', 'OK', '404', '500', '{ }', '0x', 'deadbeef',
  'psql', 'mongo', 'redis-cli', 'nginx', '-t', 'rsync', '-avz',
  'WebTerm', 'WebTerm', 'WebTerm', '◫', '~', '$',
];
const headColors = ['rgba(122,162,247,0.22)', 'rgba(187,154,247,0.18)', 'rgba(125,207,255,0.15)'];
const tailColors = ['rgba(122,162,247,0.06)', 'rgba(187,154,247,0.04)', 'rgba(125,207,255,0.03)'];

function genRain(columns: number) {
  return Array.from({ length: columns }, (_, i) => {
    const x = (i / columns) * 100 + (Math.random() * 6 - 3);
    const len = 4 + Math.floor(Math.random() * 12);
    const head = headColors[i % 3];
    const tail = tailColors[i % 3];
    const top = -20 + Math.random() * 120;
    const chars = Array.from({ length: len }, (_, j) => ({
      char: words[Math.floor(Math.random() * words.length)],
      isHead: j < 2,
    }));
    return { x, top, head, tail, chars };
  });
}

export default function MatrixRain({ fontSize = 16, columns = 24, opacity = 1, radial = false }: Props) {
  const [cols] = useState(() => genRain(columns));

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', opacity,
      fontFamily: '"JetBrains Mono", "JetBrains Maple Mono", Consolas, monospace', fontSize, lineHeight: 1.3, userSelect: 'none',
      ...(radial ? { background: 'radial-gradient(ellipse at 50% 0%, rgba(122,162,247,0.04) 0%, transparent 60%)' } : {}),
    }}>
      {cols.map((col, i) => (
        <div key={i} style={{ position: 'absolute', left: `${col.x}%`, top: `${col.top}%`, whiteSpace: 'pre' }}>
          {col.chars.map((c, j) => (
            <div key={j} style={{
              color: c.isHead ? col.head : col.tail,
              textShadow: c.isHead ? `0 0 3px ${col.head}` : 'none',
            }}>
              {c.char}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
