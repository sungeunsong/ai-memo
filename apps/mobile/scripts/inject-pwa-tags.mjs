/**
 * export가 만든 index.html에 PWA 태그를 넣습니다.
 *
 * Expo 웹 export는 HTML 템플릿을 그대로 쓸 수 없어서, 만들어진 결과물에
 * 태그를 얹습니다. 이게 없으면 홈 화면에 추가해도 사파리 주소창이 그대로 뜨고
 * 아이콘도 화면 캡처로 잡힙니다. 앱처럼 안 보이면 써보는 사람이
 * 제품이 아니라 껍데기를 먼저 지적하게 됩니다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const target = 'dist/index.html';

if (!existsSync(target)) {
  console.error(`${target}이 없습니다. 먼저 expo export --platform web을 실행하세요.`);
  process.exit(1);
}

const tags = [
  '<link rel="manifest" href="/manifest.json" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="시렁" />',
  '<meta name="theme-color" content="#08142e" />',
  // iOS 사파리는 여기서 벗어나면 확대/축소가 되어 입력할 때 화면이 튑니다.
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />',
].join('\n    ');

let html = readFileSync(target, 'utf8');

if (html.includes('rel="manifest"')) {
  console.log('이미 들어 있습니다. 건너뜁니다.');
  process.exit(0);
}

// 기본 viewport는 우리 것으로 대체합니다. 두 개가 남으면 뒤엣것만 적용돼 헷갈립니다.
html = html.replace(/<meta name="viewport"[^>]*\/?>/i, '');
html = html.replace('</head>', `  ${tags}\n  </head>`);

writeFileSync(target, html);
console.log('PWA 태그를 넣었습니다.');
