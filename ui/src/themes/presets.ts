export interface TerminalTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const presets: TerminalTheme[] = [
  {
    name: 'XTerminal Green',
    background: '#1f211f', foreground: '#c7d8c8',
    cursor: '#a7d7a8', cursorAccent: '#1f211f',
    selectionBackground: '#355d3a',
    black: '#1f211f', red: '#d88989', green: '#8fc58f', yellow: '#d7c58a',
    blue: '#8caec1', magenta: '#b39abb', cyan: '#91c6b0', white: '#c7d8c8',
    brightBlack: '#637366', brightRed: '#efaaaa', brightGreen: '#b4e3b4',
    brightYellow: '#eadca5', brightBlue: '#b0d2e4', brightMagenta: '#d0b7d6',
    brightCyan: '#b5ead6', brightWhite: '#eef7ef',
  },
  {
    name: 'Dracula',
    background: '#282a36', foreground: '#f8f8f2',
    cursor: '#f8f8f2', cursorAccent: '#282a36',
    selectionBackground: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  {
    name: 'Solarized Dark',
    background: '#002b36', foreground: '#839496',
    cursor: '#839496', cursorAccent: '#002b36',
    selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  {
    name: 'One Dark',
    background: '#282c34', foreground: '#abb2bf',
    cursor: '#528bff', cursorAccent: '#282c34',
    selectionBackground: '#3e4451',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#545862', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#c8ccd4',
  },
  {
    name: 'Monokai',
    background: '#272822', foreground: '#f8f8f2',
    cursor: '#f8f8f2', cursorAccent: '#272822',
    selectionBackground: '#49483e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
    brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
  },
  {
    name: 'Tokyo Night',
    background: '#1a1b26', foreground: '#c0caf5',
    cursor: '#7aa2f7', cursorAccent: '#1a1b26',
    selectionBackground: '#343b58',
    black: '#1a1b26', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
    brightBlack: '#565f89', brightRed: '#f7768e', brightGreen: '#b9f27c',
    brightYellow: '#ff9e64', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7',
    brightCyan: '#b4f9f8', brightWhite: '#cfc9c2',
  },
  {
    name: 'Ayu Dark',
    background: '#0a0e14', foreground: '#b3b1ad',
    cursor: '#ffb454', cursorAccent: '#0a0e14',
    selectionBackground: '#273747',
    black: '#0a0e14', red: '#ff3333', green: '#b8cc52', yellow: '#e7c547',
    blue: '#36a3d9', magenta: '#f07178', cyan: '#95e6cb', white: '#b3b1ad',
    brightBlack: '#4d5566', brightRed: '#ff6565', brightGreen: '#d4ff6e',
    brightYellow: '#ffd76e', brightBlue: '#68bdfc', brightMagenta: '#ff9da4',
    brightCyan: '#b7ffeb', brightWhite: '#e6e1cf',
  },
  {
    name: 'VS Code Dark',
    background: '#1e1e1e', foreground: '#d4d4d4',
    cursor: '#aeafad', cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    black: '#1e1e1e', red: '#f44747', green: '#6a9955', yellow: '#dcdcaa',
    blue: '#569cd6', magenta: '#c586c0', cyan: '#4ec9b0', white: '#d4d4d4',
    brightBlack: '#5a5a5a', brightRed: '#f44747', brightGreen: '#6a9955',
    brightYellow: '#dcdcaa', brightBlue: '#569cd6', brightMagenta: '#c586c0',
    brightCyan: '#4ec9b0', brightWhite: '#ffffff',
  },
  {
    name: 'IntelliJ Dark',
    background: '#2b2b2b', foreground: '#a9b7c6',
    cursor: '#a9b7c6', cursorAccent: '#2b2b2b',
    selectionBackground: '#3e5568',
    black: '#2b2b2b', red: '#ff6b68', green: '#6aab73', yellow: '#c4a939',
    blue: '#5e9eff', magenta: '#c97bb0', cyan: '#56a8b5', white: '#a9b7c6',
    brightBlack: '#5a5e6b', brightRed: '#ff8a80', brightGreen: '#9ccc65',
    brightYellow: '#ffe082', brightBlue: '#82b1ff', brightMagenta: '#f48fb1',
    brightCyan: '#80cbc4', brightWhite: '#cfd8dc',
  },
  {
    name: 'Cyberpunk',
    background: '#0c0b1a', foreground: '#ff00a0',
    cursor: '#ff00a0', cursorAccent: '#0c0b1a',
    selectionBackground: '#ff00a033',
    black: '#0c0b1a', red: '#ff0040', green: '#40ff40', yellow: '#ffe040',
    blue: '#4080ff', magenta: '#ff40ff', cyan: '#40ffff', white: '#e0e0ff',
    brightBlack: '#2a2060', brightRed: '#ff4080', brightGreen: '#80ff80',
    brightYellow: '#ffe080', brightBlue: '#80a0ff', brightMagenta: '#ff80ff',
    brightCyan: '#80ffff', brightWhite: '#ffffff',
  },
];

export function getTheme(name: string): TerminalTheme {
  return presets.find((t) => t.name === name) || presets[0];
}
