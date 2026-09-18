import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Render recorded frames at their observed intervals, never at a made-up
// fixed capture rate. Original JPEGs and timing manifests remain authoritative.
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/render-native-reload-videos.mjs <report-directory>');
const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
for (const entry of report.cases) {
  if (!entry.renderedFrames || entry.renderedFrames.error) continue;
  const frameDirectory = path.resolve(entry.renderedFrames.directory);
  const frames = JSON.parse(await readFile(path.join(frameDirectory, 'manifest.json'), 'utf8'));
  if (!frames.length) continue;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const file = frame => path.join(frameDirectory, `${String(frame.index).padStart(5, '0')}.jpg`);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, i) => {
    lines.push(`file ${quote(file(frame))}`);
    if (i + 1 < frames.length) lines.push(`duration ${Math.max(0.001, (frames[i + 1].metadata.timestamp - frame.metadata.timestamp)).toFixed(6)}`);
  });
  lines.push(`file ${quote(file(frames.at(-1)))}`);
  const manifest = path.join(frameDirectory, 'replay.ffconcat');
  await writeFile(manifest, lines.join('\n') + '\n');
  const video = frameDirectory + '.mp4';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-i', manifest,
    '-vf', 'scale=1920:-2', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '25',
    '-pix_fmt', 'yuv420p', '-fps_mode', 'vfr', video], { stdio: 'pipe' });
  console.log(JSON.stringify({ panel: entry.number, round: entry.round, frames: frames.length, video }));
}
