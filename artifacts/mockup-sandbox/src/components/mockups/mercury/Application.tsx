import html from './_redesigned.html?raw';
import { DocumentPreview } from './_Preview';

export function Application() {
  return <DocumentPreview html={html} title="Mercury — Application with sample data" appView />;
}
