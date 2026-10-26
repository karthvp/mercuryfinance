import html from './_current.html?raw';
import { DocumentPreview } from './_Preview';

export function Current() {
  return <DocumentPreview html={html} title="Mercury — Current design" />;
}
