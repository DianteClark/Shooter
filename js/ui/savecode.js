// Save export and import. The only screen with a real text field, because pasting a long code needs one.
import { Progress } from './progress.js';
import { esc } from './widgets.js';
import { confirmPrestige } from './prestige.js';

const ERRORS = {
  format: 'That is not a Switchyard save code.',
  checksum: 'That code is incomplete or was changed. Copy the whole thing.',
  version: 'That code is from a different version of the game.',
  data: 'That code is damaged and cannot be read.',
};

export function saveScreen(menu, { onBack, onImported }) {
  const code = Progress.exportCode();
  menu.el.dataset.screen = 'save';
  menu.el.innerHTML = `
    <header class="bar">
      <button class="back" data-act="svBack">Done</button>
      <h2>Save Code</h2>
    </header>
    <div class="sv enter">
      <div class="sv-card">
        <h4>Your save</h4>
        <p>Copy this to keep your progress or move it to another device.</p>
        <textarea class="sv-code" readonly rows="4">${esc(code)}</textarea>
        <div class="sv-row">
          <small>${code.length} characters</small>
          <button class="route small primary" data-act="svCopy"><b>Copy</b></button>
        </div>
      </div>
      <div class="sv-card">
        <h4>Load a save</h4>
        <p>Paste a code here. It replaces the progress on this phone.</p>
        <textarea class="sv-input" rows="4" placeholder="SY2..." autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
        <div class="sv-row">
          <small class="sv-err" role="status"></small>
          <button class="route small" data-act="svPaste"><b>Paste</b></button>
          <button class="route small primary" data-act="svLoad"><b>Load</b></button>
        </div>
      </div>
    </div>`;
  const input = menu.el.querySelector('.sv-input');
  const err = menu.el.querySelector('.sv-err');
  const say = text => { err.textContent = text; };
  menu.on({
    svBack: onBack,
    svCopy: async () => {
      try {
        await navigator.clipboard.writeText(code);
        menu.toast('Save code copied');
      } catch {
        // Safari can refuse the clipboard API outside a secure context; a real selection still lets the user copy.
        const box = menu.el.querySelector('.sv-code');
        box.focus();
        box.setSelectionRange(0, code.length);
        menu.toast('Code selected. Tap Copy in the menu that appears.');
      }
    },
    svPaste: async () => {
      try {
        input.value = (await navigator.clipboard.readText()) ?? '';
        say('');
      } catch {
        input.focus();
        say('Long-press the box to paste.');
      }
    },
    svLoad: () => {
      const text = input.value.trim();
      if (!text) { say('Paste a code first.'); return; }
      confirmPrestige(menu, {
        title: 'Replace this save?',
        loses: 'All progress currently on this phone.',
        keeps: 'One backup of the old save, on this phone only.',
        confirmLabel: 'Replace',
        onYes: () => {
          const r = Progress.importCode(text);
          if (r.ok) { onImported(); return; }
          say(ERRORS[r.error] ?? 'That code could not be loaded.');
        },
      });
    },
  });
  menu.show();
}
