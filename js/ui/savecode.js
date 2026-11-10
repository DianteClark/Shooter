// Save export and import. The only screen with a real text field, because pasting a long code needs one.
import { Progress } from './progress.js';
import { esc } from './widgets.js';
import { confirmPrestige } from './prestige.js';
import { ico, header } from './yard.js';
import { shake, flash } from './motion.js';

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
    ${header({ back: 'svBack', label: 'Done', title: 'Save code' })}
    <div class="sv">
      <div class="sv-card" data-in="up">
        <h4>${ico('export')}Your save</h4>
        <p>Copy this to keep your progress safe or move it to another phone.</p>
        <textarea class="sv-code" readonly rows="4">${esc(code)}</textarea>
        <div class="sv-row">
          <small>${code.length.toLocaleString('en-US')} characters</small>
          <button class="btn is-primary" data-sound="confirm" data-act="svCopy">${ico('copy')}<b>Copy</b></button>
        </div>
      </div>
      <div class="sv-card" data-in="up">
        <h4>${ico('load')}Load a save</h4>
        <p>Paste a code here. It replaces the progress on this phone.</p>
        <textarea class="sv-input" rows="4" placeholder="Paste a code that starts with SY" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
        <div class="sv-row">
          <small class="sv-err" role="status"></small>
          <button class="btn" data-act="svPaste">${ico('paste')}<b>Paste</b></button>
          <button class="btn is-primary" data-sound="confirm" data-act="svLoad">${ico('load')}<b>Load</b></button>
        </div>
      </div>
    </div>`;
  const input = menu.el.querySelector('.sv-input');
  const err = menu.el.querySelector('.sv-err');
  // An error names what went wrong and how to fix it; the card that holds it shakes once.
  const say = text => {
    err.textContent = text;
    err.parentNode.parentNode.classList.toggle('bad', !!text);
    if (text) shake(err.parentNode.parentNode, { strength: 5 });
  };
  menu.on({
    svBack: onBack,
    svCopy: async () => {
      try {
        await navigator.clipboard.writeText(code);
        flash(menu.el.querySelector('.sv-code').parentNode, { color: 'var(--c-go)', peak: 0.25 });
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
        danger: true,
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
