import html from './_redesigned.html?raw';
import { DocumentPreview } from './_Preview';

export function Redesign() {
  return <DocumentPreview html={html} title="Mercury — Redesigned website" />;
}
