// Injected into the Swagger UI page through SwaggerModule.setup options.
// Adds a fixed left sidebar listing every tag, with pinning saved in localStorage.

export const SWAGGER_CUSTOM_CSS = `
  body { display: block; padding-left: 250px; box-sizing: border-box; }
  .nav-sidebar {
    position: fixed; top: 0; left: 0; width: 250px; height: 100vh;
    background: #1b1b1b; color: #ddd; overflow-y: auto; padding: 16px 0;
    font-family: sans-serif; font-size: 13px; z-index: 999;
    scrollbar-width: thin; scrollbar-color: #444 transparent;
  }
  .nav-sidebar::-webkit-scrollbar { width: 6px; }
  .nav-sidebar::-webkit-scrollbar-track { background: transparent; }
  .nav-sidebar::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
  .nav-sidebar::-webkit-scrollbar-thumb:hover { background: #666; }
  .nav-sidebar h4 {
    color: #fff; padding: 0 16px 8px; margin: 0 0 8px; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #c7e3d4;
  }
  .nav-sidebar a {
    display: block; padding: 6px 16px; color: #c7e3d4; text-decoration: none;
    border-left: 3px solid transparent;
  }
  .nav-sidebar a:hover { background: #2a2a2a; color: #fff; }
  .nav-sidebar a.active { border-left-color: #c7e3d4; color: #fff; background: #2a2a2a; }
  .swagger-ui { margin-left: 0; width: auto; }
`;

export const SWAGGER_CUSTOM_JS = `
  window.addEventListener('load', () => {
    const PIN_KEY = 'npm-sentinel-swagger-pinned-tags';
    const getPinned = () => {
      try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); }
      catch { return []; }
    };
    const setPinned = (arr) => {
      try { localStorage.setItem(PIN_KEY, JSON.stringify(arr)); }
      catch {}
    };

    const buildNav = () => {
      const tagSections = document.querySelectorAll('.opblock-tag-section');
      if (!tagSections.length) { setTimeout(buildNav, 300); return; }
      const existing = document.querySelector('.nav-sidebar');
      if (existing) existing.remove();
      const nav = document.createElement('div');
      nav.className = 'nav-sidebar';
      const navItems = [];
      tagSections.forEach((section) => {
        const tagEl = section.querySelector('.opblock-tag');
        if (!tagEl) return;
        const label = (tagEl.querySelector('span')?.textContent || tagEl.textContent).trim();
        if (!section.id) {
          section.id = 'tag-' + label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        }
        navItems.push({ label, section });
      });
      navItems.sort((a, b) => a.label.localeCompare(b.label));

      const makeLink = (label, section, pinned) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        const link = document.createElement('a');
        link.textContent = label;
        link.href = '#' + section.id;
        link.style.flex = '1';
        link.onclick = (e) => {
          e.preventDefault();
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.querySelectorAll('.nav-sidebar a').forEach((a) => a.classList.remove('active'));
          link.classList.add('active');
        };
        const pinBtn = document.createElement('button');
        pinBtn.textContent = pinned ? '\\u2605' : '\\u2606';
        pinBtn.title = pinned ? 'Unpin' : 'Pin';
        pinBtn.style.background = 'none';
        pinBtn.style.border = 'none';
        pinBtn.style.color = '#fff';
        pinBtn.style.cursor = 'pointer';
        pinBtn.style.padding = '0 12px';
        pinBtn.style.fontSize = '13px';
        pinBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pinnedList = getPinned();
          const idx = pinnedList.indexOf(label);
          if (idx === -1) pinnedList.push(label);
          else pinnedList.splice(idx, 1);
          setPinned(pinnedList);
          buildNav();
        };
        row.appendChild(link);
        row.appendChild(pinBtn);
        return row;
      };

      const pinnedLabels = getPinned();
      const pinnedItems = pinnedLabels
        .map((label) => navItems.find((i) => i.label === label))
        .filter(Boolean);
      const unpinnedItems = navItems.filter((i) => !pinnedLabels.includes(i.label));
      if (pinnedItems.length) {
        const pinnedHeader = document.createElement('h4');
        pinnedHeader.textContent = 'Pinned';
        nav.appendChild(pinnedHeader);
        pinnedItems.forEach(({ label, section }) => nav.appendChild(makeLink(label, section, true)));
        const divider = document.createElement('div');
        divider.style.marginBottom = '12px';
        nav.appendChild(divider);
      }
      const header = document.createElement('h4');
      header.textContent = 'Endpoints';
      nav.appendChild(header);
      unpinnedItems.forEach(({ label, section }) => nav.appendChild(makeLink(label, section, false)));
      document.body.prepend(nav);
    };

    buildNav();
  });
`;
