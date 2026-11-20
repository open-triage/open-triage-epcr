import type { Locator } from '@playwright/test';

export async function importAndroidFile(input: Locator, file: {name: string; mimeType: string; buffer: Buffer}) {
  // Opening the chooser waits for the same enabled control that a user needs.
  const [chooser] = await Promise.all([input.page().waitForEvent('filechooser'), input.click()]);
  await chooser.setFiles(file);
}
