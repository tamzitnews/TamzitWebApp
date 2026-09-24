/* @ds-bundle: {"format":4,"namespace":"Tamzit","components":[{"name":"Logo"},{"name":"AppIcon"},{"name":"SquaresMotif"},{"name":"Icon"},{"name":"Button"},{"name":"IconButton"},{"name":"Chip"},{"name":"Segmented"},{"name":"OptionCard"},{"name":"Switch"},{"name":"LevelMeter"},{"name":"EditionHeader"},{"name":"NewsItem"},{"name":"AudioPlayer"},{"name":"GoodNews"},{"name":"EndOfEdition"},{"name":"AdSlot"},{"name":"ShareCard"},{"name":"FeedbackSheet"},{"name":"EditionRow"},{"name":"SearchField"},{"name":"PlanCard"},{"name":"DonationCard"},{"name":"SupporterBadge"},{"name":"CommunityCard"},{"name":"AppBar"},{"name":"TabBar"},{"name":"ListRow"},{"name":"ListGroup"},{"name":"PhoneFrame"},{"name":"WelcomeScreen"},{"name":"OnboardingScreen"},{"name":"EditionScreen"},{"name":"ArchiveScreen"},{"name":"SettingsScreen"},{"name":"PremiumScreen"},{"name":"ShabbatScreen"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var Fragment = React.Fragment;

  var ICONS = {"bell":[["path",{"d":"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"}],["path",{"d":"M10.3 21a1.94 1.94 0 0 0 3.4 0"}]],"bookmark-check":[["path",{"d":"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"}],["path",{"d":"m9 10 2 2 4-4"}]],"bookmark":[["path",{"d":"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["polyline",{"points":"12 6 12 12 16 14"}]],"feather":[["path",{"d":"M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"}],["path",{"d":"M16 8 2 22"}],["path",{"d":"M17.5 15H9"}]],"flag":[["path",{"d":"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"}],["line",{"x1":"4","x2":"4","y1":"22","y2":"15"}]],"flame":[["path",{"d":"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"}]],"globe":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]],"headphones":[["path",{"d":"M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"}]],"heart-handshake":[["path",{"d":"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"}],["path",{"d":"M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"}],["path",{"d":"m18 15-2-2"}],["path",{"d":"m15 18-2-2"}]],"heart":[["path",{"d":"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"}]],"history":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}],["path",{"d":"M12 7v5l4 2"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"list":[["path",{"d":"M3 12h.01"}],["path",{"d":"M3 18h.01"}],["path",{"d":"M3 6h.01"}],["path",{"d":"M8 12h13"}],["path",{"d":"M8 18h13"}],["path",{"d":"M8 6h13"}]],"lock":[["rect",{"width":"18","height":"11","x":"3","y":"11","rx":"2","ry":"2"}],["path",{"d":"M7 11V7a5 5 0 0 1 10 0v4"}]],"map-pin":[["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],"message-circle-question":[["path",{"d":"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"}],["path",{"d":"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}],["path",{"d":"M12 17h.01"}]],"message-circle":[["path",{"d":"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"}]],"moon":[["path",{"d":"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"}]],"newspaper":[["path",{"d":"M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"}],["path",{"d":"M18 14h-8"}],["path",{"d":"M15 18h-5"}],["path",{"d":"M10 6h8v4h-8V6Z"}]],"pause":[["rect",{"x":"14","y":"4","width":"4","height":"16","rx":"1"}],["rect",{"x":"6","y":"4","width":"4","height":"16","rx":"1"}]],"play":[["polygon",{"points":"6 3 20 12 6 21 6 3"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"search":[["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"settings":[["path",{"d":"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"share-2":[["circle",{"cx":"18","cy":"5","r":"3"}],["circle",{"cx":"6","cy":"12","r":"3"}],["circle",{"cx":"18","cy":"19","r":"3"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49"}]],"sliders-horizontal":[["line",{"x1":"21","x2":"14","y1":"4","y2":"4"}],["line",{"x1":"10","x2":"3","y1":"4","y2":"4"}],["line",{"x1":"21","x2":"12","y1":"12","y2":"12"}],["line",{"x1":"8","x2":"3","y1":"12","y2":"12"}],["line",{"x1":"21","x2":"16","y1":"20","y2":"20"}],["line",{"x1":"12","x2":"3","y1":"20","y2":"20"}],["line",{"x1":"14","x2":"14","y1":"2","y2":"6"}],["line",{"x1":"8","x2":"8","y1":"10","y2":"14"}],["line",{"x1":"16","x2":"16","y1":"18","y2":"22"}]],"smile":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M8 14s1.5 2 4 2 4-2 4-2"}],["line",{"x1":"9","x2":"9.01","y1":"9","y2":"9"}],["line",{"x1":"15","x2":"15.01","y1":"9","y2":"9"}]],"sprout":[["path",{"d":"M7 20h10"}],["path",{"d":"M10 20c5.5-2.5.8-6.4 3-10"}],["path",{"d":"M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"}],["path",{"d":"M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"}]],"star":[["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"sunrise":[["path",{"d":"M12 2v8"}],["path",{"d":"m4.93 10.93 1.41 1.41"}],["path",{"d":"M2 18h2"}],["path",{"d":"M20 18h2"}],["path",{"d":"m19.07 10.93-1.41 1.41"}],["path",{"d":"M22 22H2"}],["path",{"d":"m8 6 4-4 4 4"}],["path",{"d":"M16 18a4 4 0 0 0-8 0"}]],"thumbs-down":[["path",{"d":"M17 14V2"}],["path",{"d":"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"}]],"thumbs-up":[["path",{"d":"M7 10v12"}],["path",{"d":"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"}]],"type":[["polyline",{"points":"4 7 4 4 20 4 20 7"}],["line",{"x1":"9","x2":"15","y1":"20","y2":"20"}],["line",{"x1":"12","x2":"12","y1":"4","y2":"20"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["path",{"d":"M16 3.13a4 4 0 0 1 0 7.75"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]]};

  var ASSET = {
    logo: '/_blob/663ded42f8ea74a3a098f6a9d75c7ca0',
    mark: '/_blob/a6ca0fc5d33f3e5389771412c8b262a7',
    vertical: '/_blob/ccd0ae485cecc9cd459c67c7d1243ac1',
    parent: '/_blob/8ab0ad8d4e8d7aa396d0dc1d157fa3f1',
    parentMark: '/_blob/1f4f61ef95e4479c1ca59b55a4787075'
  };

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function omit(obj, keys) {
    var out = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) out[k] = obj[k];
    return out;
  }
  function useCtl(value, fallback, onChange) {
    var s = useState(value === undefined ? fallback : value);
    var cur = value === undefined ? s[0] : value;
    return [cur, function (next) { if (value === undefined) s[1](next); if (onChange) onChange(next); }];
  }
  function mmss(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- brand ---------------- */

  function Icon(p) {
    var size = p.size || 20;
    var els = ICONS[p.name] || [];
    return h('svg', {
      className: cx('tz-icon', p.flip && 'tz-flip', p.className),
      width: size, height: size, viewBox: '0 0 24 24',
      fill: p.fill ? 'currentColor' : 'none', stroke: 'currentColor',
      strokeWidth: p.strokeWidth || 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
      focusable: 'false', role: p.label ? 'img' : undefined,
      'aria-label': p.label || undefined, 'aria-hidden': p.label ? undefined : 'true'
    }, els.map(function (e, i) { return h(e[0], Object.assign({ key: i }, e[1])); }));
  }

  function Logo(p) {
    var v = p.variant || 'horizontal';
    var height = p.height || 40;
    var style = { height: height };
    if (v === 'mark') return h('span', { className: cx('tz-logo', p.className), style: style }, h('img', { src: ASSET.mark, alt: p.alt === undefined ? 'תמצית החדשות' : p.alt }));
    if (v === 'vertical') return h('span', { className: cx('tz-logo tz-logo-v', p.className), style: style }, h('img', { src: ASSET.vertical, alt: 'תמצית החדשות. להתנתק ולהישאר מחובר. מבית לוקחים אחריות' }));
    if (v === 'parent') return h('span', { className: cx('tz-logo tz-logo-plate', p.className), style: style }, h('img', { src: ASSET.parent, alt: 'לוקחים אחריות' }));
    return h('span', { className: cx('tz-logo tz-logo-h', p.className), style: style },
      h('img', { className: 'tz-logo-full', src: ASSET.logo, alt: 'תמצית החדשות' }),
      h('img', { className: 'tz-logo-mark-alt', src: ASSET.mark, alt: 'תמצית החדשות' }));
  }

  function AppIcon(p) {
    var size = p.size || 96;
    return h('span', { className: 'tz-appicon', role: 'img', 'aria-label': 'אייקון האפליקציה תמצית החדשות', style: { width: size, height: size } },
      h('img', { src: ASSET.mark, alt: '' }));
  }

  function SquaresMotif(p) {
    var size = p.size || 48;
    var a = p.flip ? 'b' : 'a', b = p.flip ? 'a' : 'b';
    return h('svg', { className: cx('tz-motif', p.className), width: size, height: size, viewBox: '0 0 2 2', 'aria-hidden': 'true', focusable: 'false', style: p.style },
      h('rect', { className: a, x: 0, y: 1, width: 1, height: 1 }),
      h('rect', { className: b, x: 1, y: 0, width: 1, height: 1 }));
  }

  /* ---------------- actions ---------------- */

  function Button(p) {
    var cls = cx('tz-btn', 'tz-btn-' + (p.variant || 'primary'), p.size === 'lg' && 'tz-btn-lg', p.block && 'tz-btn-block', p.className);
    var rest = omit(p, ['variant', 'size', 'block', 'icon', 'iconEnd', 'children', 'className', 'href']);
    var kids = [
      p.icon ? h(Icon, { key: 'i', name: p.icon, size: 20, fill: p.iconFill }) : null,
      h('span', { key: 't' }, p.children),
      p.iconEnd ? h(Icon, { key: 'e', name: p.iconEnd, size: 20, flip: p.iconEnd.indexOf('chevron') === 0 }) : null
    ];
    delete rest.iconFill;
    if (p.href) return h('a', Object.assign({ className: cls, href: p.href }, rest), kids);
    return h('button', Object.assign({ type: 'button', className: cls }, rest), kids);
  }

  function IconButton(p) {
    var rest = omit(p, ['icon', 'label', 'variant', 'pressed', 'size', 'className', 'fill']);
    return h('button', Object.assign({
      type: 'button', className: cx('tz-iconbtn', p.variant && 'tz-iconbtn-' + p.variant, p.className),
      'aria-label': p.label, 'aria-pressed': p.pressed === undefined ? undefined : String(!!p.pressed), title: p.label
    }, rest), h(Icon, { name: p.icon, size: p.size || 22, fill: p.fill }));
  }

  /* ---------------- selection ---------------- */

  function Chip(p) {
    var st = useCtl(p.selected, !!p.defaultSelected, p.onChange);
    return h('button', {
      type: 'button', className: cx('tz-chip', p.className), 'aria-pressed': String(!!st[0]),
      onClick: function () { st[1](!st[0]); }, style: p.style
    },
      st[0] ? h(Icon, { name: 'check', size: 18, className: 'tz-chip-check', strokeWidth: 2.25 }) : (p.icon ? h(Icon, { name: p.icon, size: 18 }) : null),
      h('span', null, p.children));
  }

  var segSeq = 0;
  function Segmented(p) {
    var nameRef = React.useRef(null);
    if (!nameRef.current) nameRef.current = p.name || ('tz-seg-' + (++segSeq));
    var opts = p.options || [];
    var st = useCtl(p.value, p.defaultValue === undefined ? (opts[0] && opts[0].value) : p.defaultValue, p.onChange);
    return h('fieldset', { className: cx('tz-seg', p.className) },
      p.legend ? h('legend', null, p.legend) : null,
      h('div', { className: 'tz-seg-track' }, opts.map(function (o) {
        return h('label', { key: o.value, className: 'tz-seg-opt' },
          h('input', { type: 'radio', name: nameRef.current, value: o.value, checked: st[0] === o.value, onChange: function () { st[1](o.value); } }),
          h('span', null, o.label, o.hint ? h('small', null, o.hint) : null));
      })));
  }

  function OptionCard(p) {
    var input = { type: p.type || 'radio', name: p.name, value: p.value, onChange: p.onChange };
    if (p.checked !== undefined) input.checked = p.checked; else input.defaultChecked = p.defaultChecked;
    return h('label', { className: cx('tz-opt', p.className), lang: p.lang, dir: p.dir },
      h('input', input),
      p.media ? p.media : (p.icon ? h('span', { className: 'tz-opt-ico' }, h(Icon, { name: p.icon, size: 22 })) : null),
      h('span', { className: 'tz-opt-body' },
        h('span', { className: 'tz-opt-title' }, p.title),
        p.description ? h('span', { className: 'tz-opt-desc' }, p.description) : null,
        p.sample ? h('span', { className: 'tz-opt-sample' }, p.sample) : null),
      h('span', { className: 'tz-opt-radio', 'aria-hidden': 'true' }));
  }

  function Switch(p) {
    var input = { type: 'checkbox', role: 'switch', disabled: p.disabled, onChange: p.onChange ? function (e) { p.onChange(e.target.checked); } : undefined };
    if (p.checked !== undefined) input.checked = p.checked; else input.defaultChecked = p.defaultChecked;
    return h('label', { className: cx('tz-switch', p.className) },
      h('span', { className: 'tz-switch-text' },
        h('span', { className: 'tz-switch-title' }, p.label),
        p.description ? h('span', { className: 'tz-switch-desc' }, p.description) : null),
      h('input', input),
      h('span', { className: 'tz-switch-track', 'aria-hidden': 'true' }));
  }

  /* ---------------- news ---------------- */

  var LEVELS = {
    critical: { n: 3, label: 'קריטי' },
    important: { n: 2, label: 'חשוב' },
    general: { n: 1, label: 'כללי' }
  };

  function LevelMeter(p) {
    var lv = LEVELS[p.level] || LEVELS.general;
    var showLabel = p.showLabel !== false;
    return h('span', { className: cx('tz-level', 'tz-level-' + (p.level || 'general'), p.className) },
      h('span', { className: 'tz-level-sq', 'aria-hidden': 'true' },
        [0, 1, 2].map(function (i) { return h('i', { key: i, className: i < lv.n ? 'on' : '' }); })),
      showLabel ? h('span', null, lv.label) : h('span', { className: 'tz-sr' }, 'רמת חשיבות: ' + lv.label));
  }

  var PERIODS = {
    morning: { name: 'מהדורת הבוקר', icon: 'sunrise' },
    noon: { name: 'מהדורת הצהריים', icon: 'sun' },
    evening: { name: 'מהדורת הערב', icon: 'moon' },
    motzash: { name: 'מהדורת מוצאי שבת', icon: 'flame' }
  };

  function EditionHeader(p) {
    var per = PERIODS[p.period || 'morning'];
    return h('header', { className: cx('tz-edhead', p.className) },
      h('span', { className: 'tz-edhead-kicker' }, h(Icon, { name: per.icon, size: 18 }), p.date || 'יום ה׳, 24 בספטמבר'),
      h('h1', { className: 'tz-t-display' }, p.title || per.name),
      h('div', { className: 'tz-edhead-meta' },
        h('span', { className: 'tz-edhead-count' }, (p.items || 6) + ' ידיעות · ' + (p.minutes || 4) + ' דק׳ קריאה'),
        p.audio === false ? null : h(Button, { variant: 'secondary', icon: 'headphones', onClick: p.onListen, style: { minHeight: 40 } }, 'האזנה')));
  }

  function NewsItem(p) {
    var saved = useCtl(p.saved, !!p.defaultSaved, p.onSaveChange);
    return h('article', { className: cx('tz-item', p.className) },
      h('div', { className: 'tz-item-top' },
        h('span', { className: 'tz-item-topic' }, p.topic, p.time ? ' · ' + p.time : ''),
        h(LevelMeter, { level: p.level || 'general', showLabel: p.level === 'critical' || p.showLevelLabel })),
      h('h3', null, p.headline),
      h('p', null, p.children || p.body),
      p.actions === false ? null : h('div', { className: 'tz-item-actions' },
        h(IconButton, { icon: saved[0] ? 'bookmark-check' : 'bookmark', label: saved[0] ? 'נשמר' : 'שמירה', pressed: saved[0], onClick: function () { saved[1](!saved[0]); } }),
        h(IconButton, { icon: 'share-2', label: 'שיתוף', onClick: p.onShare }),
        h(IconButton, { icon: 'message-circle-question', label: 'משוב על הידיעה', onClick: p.onFeedback })));
  }

  var SPEEDS = [1, 1.25, 1.5, 0.75];
  function AudioPlayer(p) {
    var playing = useCtl(p.playing, false, p.onToggle);
    var speed = useCtl(p.speed, 1, p.onSpeed);
    var dur = p.duration || 252, pos = p.position === undefined ? 81 : p.position;
    return h('div', { className: cx('tz-player', p.className), role: 'region', 'aria-label': 'נגן המהדורה הקולית', style: p.style },
      h('button', { type: 'button', className: 'tz-player-play', 'aria-label': playing[0] ? 'השהיה' : 'השמעה', onClick: function () { playing[1](!playing[0]); } },
        h(Icon, { name: playing[0] ? 'pause' : 'play', size: 20, fill: true })),
      h('div', { className: 'tz-player-main' },
        h('div', { className: 'tz-player-title' }, p.title || 'האזנה · מהדורת הבוקר'),
        h('div', { className: 'tz-player-bar', role: 'progressbar', 'aria-label': 'התקדמות', 'aria-valuemin': 0, 'aria-valuemax': dur, 'aria-valuenow': pos, 'aria-valuetext': mmss(pos) + ' מתוך ' + mmss(dur) },
          h('i', { style: { width: Math.round((pos / dur) * 100) + '%' } })),
        h('div', { className: 'tz-player-time' }, h('span', null, mmss(pos)), h('span', null, mmss(dur)))),
      h('button', { type: 'button', dir: 'ltr', className: 'tz-player-speed', 'aria-label': 'מהירות השמעה ' + speed[0], onClick: function () { var i = SPEEDS.indexOf(speed[0]); speed[1](SPEEDS[(i + 1) % SPEEDS.length]); } }, speed[0] + '×'));
  }

  function GoodNews(p) {
    return h('section', { className: cx('tz-good', p.className), 'aria-label': 'ונסיים בטוב' },
      h('div', { className: 'tz-good-kicker' }, h('span', { className: 'tz-good-ico' }, h(Icon, { name: 'sprout', size: 18 })), 'ונסיים בטוב'),
      h('h3', null, p.title),
      h('p', null, p.children || p.body));
  }

  function EndOfEdition(p) {
    return h('section', { className: cx('tz-end', p.className) },
      h('span', { className: 'tz-end-check' }, h(Icon, { name: 'check', size: 32, strokeWidth: 2.25 })),
      h('h2', null, p.title || 'זהו, אתם מעודכנים'),
      h('p', null, p.text || 'אין מה לגלול יותר. אפשר להניח את הטלפון ולחזור לחיים.'),
      p.nextTime ? h('span', { className: 'tz-end-next' }, h(Icon, { name: 'clock', size: 18 }), 'הבאה: ' + (p.nextName || 'מהדורת הצהריים') + ' · ' + p.nextTime) : null);
  }

  function AdSlot(p) {
    return h('aside', { className: cx('tz-ad', p.className), 'aria-label': 'פרסומת' },
      h('div', { className: 'tz-ad-top' },
        h('span', { className: 'tz-ad-label' }, 'פרסומת'),
        h('button', { type: 'button', className: 'tz-ad-remove', onClick: p.onRemoveAds }, 'להסרת פרסומות')),
      h('div', { className: 'tz-ad-sponsor' }, p.sponsor || '[שם המפרסם]'),
      h('p', { className: 'tz-ad-text' }, p.children || '[מסר פרסומי קצר, עד שתי שורות, בלי תמונות מהבהבות]'));
  }

  function ShareCard(p) {
    return h('div', { className: cx('tz tz-share', p.className), 'data-theme': 'light', dir: 'rtl', lang: 'he' },
      h(SquaresMotif, { size: 72, className: 'tz-share-motif' }),
      h(Logo, { variant: 'horizontal', height: 40 }),
      h('div', { className: 'tz-share-topic' }, p.topic || 'מזג אוויר'),
      h('h3', null, p.headline || 'גשם ראשון צפוי בסוף השבוע בצפון'),
      h('p', null, p.body || 'התחזית צופה ירידה בטמפרטורות וממטרים מקומיים, בעיקר בגליל ובגולן. במרכז ובדרום יישאר נאה.'),
      h('div', { className: 'tz-share-foot' },
        h('span', null, p.date || '24.09.2026'),
        h('span', { dir: 'ltr' }, 'tamzit.org.il')));
  }

  function FeedbackSheet(p) {
    var rate = useState(null), kind = useState('error');
    return h('div', { className: cx('tz-sheet', p.className), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tz-fb-title', style: p.style },
      h('div', { className: 'tz-sheet-grip', 'aria-hidden': 'true' }),
      h('div', { className: 'tz-sheet-head' },
        h('h2', { id: 'tz-fb-title', className: 'tz-t-title' }, 'משוב על הידיעה'),
        h(IconButton, { icon: 'x', label: 'סגירה', onClick: p.onClose })),
      h('div', { className: 'tz-sheet-rate' },
        h(Button, { variant: rate[0] === 'up' ? 'primary' : 'secondary', icon: 'thumbs-up', 'aria-pressed': String(rate[0] === 'up'), onClick: function () { rate[1]('up'); } }, 'מועיל'),
        h(Button, { variant: rate[0] === 'down' ? 'primary' : 'secondary', icon: 'thumbs-down', 'aria-pressed': String(rate[0] === 'down'), onClick: function () { rate[1]('down'); } }, 'לא מועיל')),
      h('div', { className: 'tz-sheet-kinds' },
        h(Chip, { icon: 'flag', selected: kind[0] === 'error', onChange: function () { kind[1]('error'); } }, 'דיווח על טעות'),
        h(Chip, { icon: 'message-circle-question', selected: kind[0] === 'ask', onChange: function () { kind[1]('ask'); } }, 'שאלה לעורכים')),
      h('label', { htmlFor: 'tz-fb-text', className: 'tz-t-caption' }, kind[0] === 'error' ? 'מה לא מדויק?' : 'מה תרצו לשאול?'),
      h('textarea', { id: 'tz-fb-text', placeholder: kind[0] === 'error' ? 'כתבו לנו מה צריך לתקן, ואם אפשר גם מקור' : 'העורכים עונים בתוך יום עבודה' }),
      h(Button, { block: true, size: 'lg', style: { marginTop: 16 } }, 'שליחה'));
  }

  /* ---------------- archive ---------------- */

  function EditionRow(p) {
    var per = PERIODS[p.period || 'morning'];
    return h('button', { type: 'button', className: cx('tz-edrow', p.className), 'aria-disabled': p.locked ? 'true' : undefined, onClick: p.onClick },
      h('span', { className: 'tz-edrow-ico' }, h(Icon, { name: per.icon, size: 22 })),
      h('span', { className: 'tz-edrow-main' },
        h('span', { className: 'tz-edrow-title' }, p.title || per.name),
        h('span', { className: 'tz-edrow-meta' }, p.meta)),
      p.locked ? h('span', { className: 'tz-lockpill' }, h(Icon, { name: 'lock', size: 14 }), 'פרימיום')
        : (p.unread ? h('span', { className: 'tz-edrow-dot', role: 'img', 'aria-label': 'לא נקראה' }) : h(Icon, { name: 'chevron-left', size: 20, className: 'tz-listrow-chev' })));
  }

  function SearchField(p) {
    return h('div', { className: cx('tz-search', p.className) },
      h('label', { className: 'tz-sr', htmlFor: p.id || 'tz-search' }, p.label || 'חיפוש בארכיון'),
      h(Icon, { name: 'search', size: 20, className: 'tz-search-ico' }),
      h('input', { id: p.id || 'tz-search', type: 'search', placeholder: p.placeholder || 'חיפוש בכל המהדורות', disabled: p.locked, defaultValue: p.defaultValue }),
      p.locked ? h('span', { className: 'tz-lockpill' }, h(Icon, { name: 'lock', size: 14 }), 'פרימיום') : null);
  }

  /* ---------------- support ---------------- */

  function PlanCard(p) {
    return h('section', { className: cx('tz-plan', p.highlighted && 'tz-plan-hl', p.className), 'aria-label': p.name },
      p.ribbon ? h('span', { className: 'tz-plan-ribbon' }, p.ribbon) : null,
      h('div', null, h('h3', { className: 'tz-plan-name' }, p.name), h('div', { className: 'tz-plan-price' }, p.price)),
      h('ul', null, (p.features || []).map(function (f, i) { return h('li', { key: i }, h(Icon, { name: 'check', size: 18, strokeWidth: 2.25 }), h('span', null, f)); })),
      p.cta ? h(Button, { variant: p.highlighted ? 'primary' : 'secondary', block: true, disabled: p.current }, p.current ? 'המסלול הנוכחי' : p.cta) : null);
  }

  function DonationCard(p) {
    var amounts = p.amounts || [18, 36, 100, 180];
    var amt = useState(p.defaultAmount || amounts[1]);
    return h('section', { className: cx('tz-donate', p.className), 'aria-labelledby': 'tz-donate-title' },
      h('div', { className: 'tz-donate-head' },
        h('span', { className: 'tz-donate-ico' }, h(Icon, { name: 'heart-handshake', size: 22 })),
        h('div', null,
          h('h3', { id: 'tz-donate-title', className: 'tz-t-headline' }, p.title || 'תמיכה בעמותה'),
          h('p', { className: 'tz-t-caption tz-muted', style: { margin: '2px 0 0' } }, p.text || 'תמצית החדשות היא מחלקה של עמותת לוקחים אחריות. תרומה מאפשרת לנו להמשיך לכתוב חדשות נקיות, בלי רעש ובלי פושים.'))),
      h(Segmented, { legend: 'סוג התרומה', options: [{ value: 'once', label: 'חד־פעמית' }, { value: 'monthly', label: 'חודשית' }], defaultValue: p.frequency || 'monthly' }),
      h('div', { role: 'group', 'aria-label': 'סכום' },
        h('div', { className: 'tz-donate-amounts' }, amounts.map(function (a) {
          return h(Chip, { key: a, selected: amt[0] === a, onChange: function () { amt[1](a); } }, '₪' + a);
        }))),
      h(Button, { block: true, size: 'lg', icon: 'heart' }, 'לתרומה של ₪' + amt[0]));
  }

  function SupporterBadge(p) {
    return h('span', { className: cx('tz-badge', p.className) }, h(Icon, { name: 'star', size: 14, fill: true }), p.label || 'תומך/ת');
  }

  function CommunityCard(p) {
    var joined = useCtl(p.joined, !!p.defaultJoined, p.onChange);
    return h('div', { className: cx('tz-comm', p.className) },
      h('span', { className: 'tz-comm-ico' }, h(Icon, { name: 'map-pin', size: 22 })),
      h('span', { className: 'tz-comm-main' },
        h('span', { className: 'tz-comm-name' }, p.name),
        p.description ? h('span', { className: 'tz-comm-desc' }, p.description) : null),
      h(Button, { variant: joined[0] ? 'primary' : 'secondary', icon: joined[0] ? 'check' : 'plus', 'aria-pressed': String(!!joined[0]), onClick: function () { joined[1](!joined[0]); }, style: { minHeight: 40, paddingInline: 14 } }, joined[0] ? 'נוסף' : 'הוספה'));
  }

  /* ---------------- navigation ---------------- */

  function AppBar(p) {
    return h('div', { className: cx('tz-appbar', p.className) },
      p.back ? h(IconButton, { icon: 'chevron-right', label: 'חזרה', onClick: p.onBack, style: { marginInlineStart: -10 } })
        : (p.logo === false ? null : h(Logo, { variant: 'mark', height: 36, className: 'tz-appbar-mark', alt: '' })),
      h('div', { className: 'tz-appbar-text' },
        h('span', { className: 'tz-appbar-title' }, p.title || 'תמצית החדשות'),
        p.subtitle ? h('span', { className: 'tz-appbar-sub' }, p.subtitle) : null),
      p.children,
      p.actions ? h('div', { className: 'tz-appbar-actions' }, p.actions.map(function (a, i) { return h(IconButton, Object.assign({ key: i }, a)); })) : null);
  }

  var TABS = [
    { id: 'edition', label: 'המהדורה', icon: 'newspaper' },
    { id: 'archive', label: 'ארכיון', icon: 'history' },
    { id: 'saved', label: 'שמורים', icon: 'bookmark' },
    { id: 'settings', label: 'הגדרות', icon: 'settings' }
  ];
  function TabBar(p) {
    var st = useCtl(p.active, 'edition', p.onChange);
    return h('nav', { className: cx('tz-tabbar', p.className), 'aria-label': 'ניווט ראשי' }, TABS.map(function (t) {
      return h('button', { key: t.id, type: 'button', className: 'tz-tab', 'aria-current': st[0] === t.id ? 'page' : undefined, onClick: function () { st[1](t.id); } },
        h(Icon, { name: t.icon, size: 24, strokeWidth: st[0] === t.id ? 2.1 : 1.75 }), t.label);
    }));
  }

  function ListRow(p) {
    return h('button', { type: 'button', className: cx('tz-listrow', p.className), onClick: p.onClick },
      p.icon ? h(Icon, { name: p.icon, size: 22, className: 'tz-listrow-ico' }) : null,
      h('span', { className: 'tz-listrow-title' }, p.title),
      p.badge || null,
      p.value ? h('span', { className: 'tz-listrow-value' }, p.value) : null,
      p.chevron === false ? null : h(Icon, { name: 'chevron-left', size: 20, className: 'tz-listrow-chev' }));
  }

  function ListGroup(p) {
    return h(Fragment, null,
      p.label ? h('h2', { className: 'tz-group-label' }, p.label) : null,
      h('div', { className: cx('tz-group', p.className) }, p.children));
  }

  /* ---------------- screens ---------------- */

  function PhoneFrame(p) {
    var phone = h('div', { className: 'tz tz-phone', dir: p.dir || 'rtl', lang: p.lang || 'he', 'data-theme': p.theme },
      h('div', { className: 'tz-screen' }, p.children));
    if (!p.caption) return phone;
    return h('figure', { className: 'tz-phone-wrap', style: { margin: 0 } }, phone, h('figcaption', { className: 'tz-phone-cap' }, p.caption));
  }

  function CtaArea(p) {
    return h('div', { className: 'tz-cta-area' }, p.children);
  }

  function WelcomeScreen(p) {
    return h(Fragment, null,
      h('div', { className: 'tz-welcome' },
        h(SquaresMotif, { size: 96, style: { position: 'absolute', top: 0, insetInlineEnd: 0 } }),
        h(SquaresMotif, { size: 64, flip: true, style: { position: 'absolute', bottom: 0, insetInlineStart: 0 } }),
        h(Logo, { variant: 'horizontal', height: 64 }),
        h('h1', { className: 'tz-t-display', style: { marginTop: 16 } }, 'צורכים חדשות אחרת'),
        h('p', { className: 'tz-t-body tz-muted', style: { maxWidth: 280 } }, 'כל מה שחשוב, בזמנים קבועים. בלי רעש, בלי סטרס, ובלי לפספס.'),
        h('span', { className: 'tz-tagline' }, 'להתנתק ולהישאר מחובר')),
      h(CtaArea, null,
        h(Button, { block: true, size: 'lg', onClick: p.onStart }, 'בואו נתאים לכם מהדורה'),
        h(Button, { variant: 'quiet', block: true, style: { marginTop: 8 } }, 'כבר מנויים? כניסה')));
  }

  var TOPICS = ['פוליטיקה', 'ביטחון', 'כלכלה', 'בריאות', 'חינוך', 'משפט', 'עולם', 'מדע וטכנולוגיה', 'תחבורה', 'מזג אוויר', 'צרכנות', 'יהדות ומסורת', 'תרבות', 'ספורט'];
  var TOPICS_ON = ['ביטחון', 'כלכלה', 'בריאות', 'חינוך', 'מזג אוויר', 'תחבורה', 'עולם'];

  function Steps(p) {
    return h('div', { className: 'tz-steps', role: 'progressbar', 'aria-label': 'שלב ' + p.at + ' מתוך ' + p.of, 'aria-valuemin': 1, 'aria-valuemax': p.of, 'aria-valuenow': p.at },
      Array.apply(null, Array(p.of)).map(function (_, i) { return h('i', { key: i, className: i < p.at ? 'on' : '' }); }));
  }

  function OnboardingScreen(p) {
    var step = p.step || 'language';
    var order = ['language', 'topics', 'rhythm', 'style'];
    var at = order.indexOf(step) + 1;
    var body, title, sub;
    if (step === 'language') {
      title = 'באיזו שפה תרצו לקרוא?';
      sub = 'המהדורות נכתבות בשלוש שפות. אפשר לשנות בכל עת.';
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(OptionCard, { name: 'ob-lang', value: 'he', title: 'עברית', defaultChecked: true, lang: 'he' }),
        h(OptionCard, { name: 'ob-lang', value: 'en', title: 'English', lang: 'en' }),
        h(OptionCard, { name: 'ob-lang', value: 'fr', title: 'Français', lang: 'fr' }));
    } else if (step === 'topics') {
      title = 'על מה תרצו להתעדכן?';
      sub = 'בחרו כמה שתרצו. ידיעות קריטיות מגיעות תמיד, מכל נושא.';
      body = h(Fragment, null,
        h('div', { className: 'tz-chipwrap' }, TOPICS.map(function (t) { return h(Chip, { key: t, defaultSelected: TOPICS_ON.indexOf(t) >= 0 }, t); })),
        h('h2', { className: 'tz-group-label', style: { marginTop: 24 } }, 'מהדורה קהילתית (לא חובה)'),
        h(CommunityCard, { name: 'ירושלים', description: 'חדשות העיר, בסוף כל מהדורה' }));
    } else if (step === 'rhythm') {
      title = 'מתי ומה לקבל?';
      sub = null;
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h(Segmented, { legend: 'תדירות', defaultValue: '3', options: [{ value: '1', label: 'פעם', hint: 'ערב' }, { value: '2', label: 'פעמיים', hint: 'בוקר וערב' }, { value: '3', label: '3 פעמים', hint: 'גם בצהריים' }] }),
        h('div', { className: 'tz-group' }, h(ListRow, { icon: 'clock', title: 'שעות', value: '07:30 · 13:00 · 20:00' })),
        h('fieldset', { className: 'tz-seg', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('legend', null, 'אילו ידיעות להציג?'),
          h(OptionCard, { name: 'ob-level', value: 'critical', title: 'רק קריטיות', description: 'מה שמשפיע עליכם ישירות, היום', media: h('span', { className: 'tz-opt-media' }, h(LevelMeter, { level: 'critical', showLabel: false })) }),
          h(OptionCard, { name: 'ob-level', value: 'important', title: 'קריטיות וחשובות', description: 'מה שכדאי לדעת. מומלץ', defaultChecked: true, media: h('span', { className: 'tz-opt-media' }, h(LevelMeter, { level: 'important', showLabel: false })) }),
          h(OptionCard, { name: 'ob-level', value: 'general', title: 'הכל', description: 'כולל ידיעות קלות ורקע', media: h('span', { className: 'tz-opt-media' }, h(LevelMeter, { level: 'general', showLabel: false })) })));
    } else {
      title = 'באיזה סגנון לכתוב לכם?';
      sub = 'אותה ידיעה, ארבעה קולות.';
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(OptionCard, { name: 'ob-style', value: 'calm', icon: 'feather', title: 'מרגיע', description: 'שקט, בלי דרמה, עם הקשר מרגיע', defaultChecked: true, sample: '“גשם ראשון בדרך לצפון. אין צורך בהיערכות מיוחדת, רק מטרייה קרובה.”' }),
        h(OptionCard, { name: 'ob-style', value: 'human', icon: 'heart', title: 'אנושי', description: 'האנשים שמאחורי הידיעה', sample: '“בצפון מחכים לגשם הראשון, ובעיקר החקלאים: ‘זה בדיוק מה שהאדמה צריכה’.”' }),
        h(OptionCard, { name: 'ob-style', value: 'info', icon: 'list', title: 'אינפורמטיבי', description: 'עובדות, מספרים, תכל׳ס', sample: '“תחזית: גשם ראשון ביום שישי בגליל ובגולן, וירידה בטמפרטורות.”' }),
        h(OptionCard, { name: 'ob-style', value: 'light', icon: 'smile', title: 'קליל', description: 'בגובה העיניים, עם חיוך', sample: '“הוציאו את המטריות מהבוידעם: הגשם הראשון מגיע בשישי.”' }));
    }
    return h(Fragment, null,
      h('div', { className: 'tz-screen-body tz-screen-pad', style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          at > 1 ? h(IconButton, { icon: 'chevron-right', label: 'חזרה', style: { marginInlineStart: -10 } }) : null,
          h('div', { style: { flex: 1 } }, h(Steps, { at: at, of: 4 }))),
        h('div', null,
          h('h1', { className: 'tz-t-display', style: { fontSize: 26, lineHeight: '32px' } }, title),
          sub ? h('p', { className: 'tz-t-caption tz-muted', style: { margin: '6px 0 0' } }, sub) : null),
        body),
      h(CtaArea, null, h(Button, { block: true, size: 'lg' }, step === 'style' ? 'סיום' : 'המשך')));
  }

  var SAMPLE_ITEMS = [
    { topic: 'מים', level: 'critical', time: '07:10', headline: 'שיבוש באספקת המים בדרום ירושלים עד הערב', body: 'בעקבות תקלה בצנרת ראשית צפוי לחץ מים נמוך בכמה שכונות עד 18:00. תאגיד המים מציב נקודות חלוקה.' },
    { topic: 'מזג אוויר', level: 'important', time: '06:45', headline: 'גשם ראשון צפוי בסוף השבוע בצפון', body: 'התחזית צופה ירידה בטמפרטורות וממטרים מקומיים, בעיקר בגליל ובגולן. במרכז ובדרום יישאר נאה.' },
    { topic: 'תחבורה', level: 'general', time: '06:30', headline: 'עבודות לילה בנתיבי איילון השבוע', body: 'הנתיבים צפונה ייסגרו חלקית בלילות, בין 23:00 ל־05:00. מומלץ לתכנן נסיעה מוקדמת.' }
  ];

  function Scrim() {
    return h('div', { 'aria-hidden': 'true', style: { position: 'absolute', inset: 0, background: 'var(--scrim)' } });
  }

  function EditionScreen(p) {
    var view = p.view || 'top';
    var items = p.items || SAMPLE_ITEMS;
    var body;
    if (view === 'end') {
      body = h('div', { className: 'tz-screen-body', style: { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 16 } },
        h(NewsItem, { topic: 'חינוך', level: 'general', time: '06:20', headline: 'נפתח הרישום לתוכניות הקיץ בבתי הספר', body: 'ההרשמה נעשית דרך אתר הרשות המקומית. מספר המקומות בכל תוכנית מוגבל.' }),
        p.premium ? null : h(AdSlot, null),
        h('h2', { className: 'tz-group-label', style: { margin: '8px 0 -8px' } }, 'בקהילה שלך · ירושלים'),
        h(NewsItem, { topic: 'ירושלים', level: 'general', headline: 'שינוי בתדירות הקו האדום ברכבת הקלה', body: 'בשבוע הבא הרכבות יגיעו כל 8 דקות בשעות הערב, בגלל עבודות תחזוקה.' }),
        h(GoodNews, { title: 'תלמידי תיכון בנו מערכת השקיה לגינה הקהילתית', body: 'הפרויקט התחיל כעבודת גמר, והיום הוא משקה את כל ערוגות השכונה.' }),
        h(EndOfEdition, { nextName: 'מהדורת הצהריים', nextTime: '13:00', className: 'tz-end-compact', title: 'זהו, אתם מעודכנים' }));
    } else {
      body = h('div', { className: 'tz-screen-body' },
        h(EditionHeader, { period: p.period || 'morning', date: p.date, items: 6, minutes: 4 }),
        items.map(function (it, i) { return h(NewsItem, Object.assign({ key: i, defaultSaved: i === 1 }, it, p.period === 'motzash' ? { time: null } : null)); }));
    }
    return h(Fragment, null,
      h(AppBar, { title: 'תמצית החדשות', actions: [{ icon: 'type', label: 'גודל טקסט' }] }),
      body,
      h('div', { className: 'tz-screen-foot' },
        h('div', { style: { padding: '8px 12px' } }, h(AudioPlayer, { playing: p.playing, title: 'האזנה · ' + PERIODS[p.period || 'morning'].name })),
        h(TabBar, { active: 'edition' })),
      p.sheet ? h(Fragment, null, h(Scrim), h(FeedbackSheet, { style: { position: 'absolute', insetInline: 0, bottom: 0 } })) : null);
  }

  function ArchiveScreen(p) {
    var tab = p.tab || 'archive';
    if (tab === 'saved') {
      return h(Fragment, null,
        h(AppBar, { title: 'שמורים', subtitle: '3 ידיעות' }),
        h('div', { className: 'tz-screen-body' },
          h(NewsItem, Object.assign({ defaultSaved: true }, SAMPLE_ITEMS[1], { time: 'היום' })),
          h(NewsItem, { defaultSaved: true, topic: 'צרכנות', level: 'general', time: 'אתמול', headline: 'מתי כדאי לחדש ביטוח רכב? מדריך קצר', body: 'השוואה בין שלוש חברות לפחות, בדיקת השתתפות עצמית, ושאלה אחת שכדאי לשאול לפני שחותמים.' })),
        h('div', { className: 'tz-screen-foot' }, h(TabBar, { active: 'saved' })));
    }
    return h(Fragment, null,
      h(AppBar, { title: 'ארכיון', subtitle: p.premium ? 'כל המהדורות' : '7 הימים האחרונים' }),
      h('div', { className: 'tz-screen-body' },
        h(SearchField, { locked: !p.premium }),
        h('h2', { className: 'tz-group-label' }, 'היום'),
        h(EditionRow, { period: 'morning', meta: '07:30 · 6 ידיעות', unread: false }),
        h('h2', { className: 'tz-group-label' }, 'אתמול, יום ד׳'),
        h(EditionRow, { period: 'evening', meta: '20:00 · 7 ידיעות', unread: true }),
        h(EditionRow, { period: 'noon', meta: '13:00 · 5 ידיעות' }),
        h(EditionRow, { period: 'morning', meta: '07:30 · 6 ידיעות' }),
        h('h2', { className: 'tz-group-label' }, 'לפני יותר משבוע'),
        h(EditionRow, { period: 'evening', meta: 'יום ג׳, 15 בספטמבר', locked: !p.premium }),
        p.premium ? null : h('div', { style: { marginTop: 16, padding: 16, borderRadius: 20, background: 'var(--sun-soft)', display: 'flex', gap: 12, alignItems: 'center' } },
          h('span', { className: 'tz-t-caption', style: { flex: 1, color: 'var(--ink)' } }, 'הארכיון המלא והחיפוש זמינים במנוי פרימיום'),
          h(Button, { variant: 'sun', style: { minHeight: 40, paddingInline: 16 } }, 'לפרטים'))),
      h('div', { className: 'tz-screen-foot' }, h(TabBar, { active: 'archive' })));
  }

  function SettingsScreen(p) {
    if (p.section === 'communities') {
      return h(Fragment, null,
        h(AppBar, { back: true, title: 'מהדורות קהילתיות', subtitle: 'חדשות מקומיות בסוף כל מהדורה' }),
        h('div', { className: 'tz-screen-body', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(SearchField, { id: 'tz-comm-search', label: 'חיפוש קהילה', placeholder: 'חיפוש עיר או קהילה' }),
          h(CommunityCard, { name: 'ירושלים', description: 'עירייה, תחבורה וחינוך', defaultJoined: true }),
          h(CommunityCard, { name: 'תל אביב־יפו', description: 'עירייה, תחבורה וחינוך' }),
          h(CommunityCard, { name: 'חיפה והקריות', description: 'עירייה, תחבורה וחינוך' }),
          h(CommunityCard, { name: 'באר שבע והנגב', description: 'עירייה, תחבורה וחינוך' }),
          h(CommunityCard, { name: 'מודיעין', description: 'עירייה, תחבורה וחינוך' })),
        h('div', { className: 'tz-screen-foot' }, h(TabBar, { active: 'settings' })));
    }
    return h(Fragment, null,
      h(AppBar, { title: 'הגדרות', logo: false }, h(SupporterBadge, null)),
      h('div', { className: 'tz-screen-body' },
        h(ListGroup, { label: 'המהדורות שלי' },
          h(ListRow, { icon: 'globe', title: 'שפה', value: 'עברית' }),
          h(ListRow, { icon: 'sliders-horizontal', title: 'נושאים', value: '7 נבחרו' }),
          h(ListRow, { icon: 'clock', title: 'תדירות', value: '3 ביום' }),
          h(ListRow, { icon: 'info', title: 'רמת ידיעות', value: 'קריטי וחשוב' }),
          h(ListRow, { icon: 'feather', title: 'סגנון', value: 'מרגיע' }),
          h(ListRow, { icon: 'map-pin', title: 'מהדורות קהילתיות', value: 'ירושלים' })),
        h(ListGroup, { label: 'שבת וחגים' },
          h(ListRow, { icon: 'flame', title: 'מצב שבת וחגים', value: 'תמיד פעיל', chevron: false }),
          h(ListRow, { icon: 'map-pin', title: 'זמני שבת לפי', value: 'ירושלים' })),
        h(ListGroup, { label: 'מנוי ותמיכה' },
          h(ListRow, { icon: 'star', title: 'פרימיום', value: 'פעיל' }),
          h(ListRow, { icon: 'users', title: 'מנוי משפחתי', value: '2 מתוך 5' }),
          h(ListRow, { icon: 'heart-handshake', title: 'תרומה לעמותה' }))),
      h('div', { className: 'tz-screen-foot' }, h(TabBar, { active: 'settings' })));
  }

  function PremiumScreen(p) {
    if (p.view === 'donate') {
      return h(Fragment, null,
        h(AppBar, { back: true, title: 'תרומה לעמותה' }),
        h('div', { className: 'tz-screen-body', style: { display: 'flex', flexDirection: 'column', gap: 20 } },
          h(DonationCard, null),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            h(Logo, { variant: 'parent', height: 36 })),
          h('p', { className: 'tz-t-caption tz-muted', style: { margin: 0 } }, 'לוקחים אחריות פועלת לשימוש בריא ומאוזן ברשת ובמדיה. תמצית החדשות היא אחת המחלקות הגדולות שלה.')));
    }
    return h(Fragment, null,
      h('div', { className: 'tz-paywall-head' },
        h(SquaresMotif, { size: 88 }),
        h(IconButton, { icon: 'x', label: 'סגירה', variant: 'hero', style: { marginInlineStart: -10 } }),
        h('h1', null, 'בלי פרסומות. עם כל הארכיון.'),
        h('p', null, 'המנוי מממן את המערכת ומשאיר את החדשות נקיות, בשבילכם ובשביל כולם.')),
      h('div', { className: 'tz-screen-body', style: { display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 28, marginTop: -16, background: 'var(--surface)', borderRadius: '20px 20px 0 0', position: 'relative' } },
        h(PlanCard, { name: 'פרימיום', price: '[מחיר] ₪ לחודש', highlighted: true, ribbon: 'מומלץ', features: ['בלי פרסומות בכלל', 'כל הארכיון, עם חיפוש', 'תג תומך/ת בפרופיל'] }),
        h(PlanCard, { name: 'משפחתי', price: '[מחיר] ₪ לחודש · עד 5 בני משפחה', features: ['כל מה שבפרימיום, לכל אחד', 'לכל אחד ההגדרות והשפה שלו'] })),
      h(CtaArea, null,
        h(Button, { block: true, size: 'lg' }, 'להצטרפות לפרימיום'),
        h('p', { className: 'tz-t-caption tz-muted', style: { margin: '8px 0 0', textAlign: 'center' } }, 'חידוש אוטומטי. ביטול בכל עת בהגדרות החנות.')));
  }

  function ShabbatScreen(p) {
    return h('div', { className: 'tz-shabbat' },
      h(SquaresMotif, { size: 72, style: { position: 'absolute', top: 0, insetInlineEnd: 0 } }),
      h('span', { className: 'tz-shabbat-glow' }, h(Icon, { name: 'flame', size: 40 })),
      h('h1', null, p.greeting || 'שבת שלום'),
      h('p', null, p.text || 'תמצית החדשות נחה בשבת. אין מהדורות ואין התראות עד צאת השבת.'),
      h('div', { className: 'tz-shabbat-next' },
        h('span', null, 'מהדורת מוצאי שבת · ' + (p.city || 'ירושלים')),
        h('b', null, p.time || '19:05')),
      h(Button, { variant: 'quiet' }, 'לקריאה במהדורות קודמות'));
  }

  var api = {
    Logo: Logo, AppIcon: AppIcon, SquaresMotif: SquaresMotif, Icon: Icon,
    Button: Button, IconButton: IconButton,
    Chip: Chip, Segmented: Segmented, OptionCard: OptionCard, Switch: Switch,
    LevelMeter: LevelMeter, EditionHeader: EditionHeader, NewsItem: NewsItem, AudioPlayer: AudioPlayer,
    GoodNews: GoodNews, EndOfEdition: EndOfEdition, AdSlot: AdSlot, ShareCard: ShareCard, FeedbackSheet: FeedbackSheet,
    EditionRow: EditionRow, SearchField: SearchField,
    PlanCard: PlanCard, DonationCard: DonationCard, SupporterBadge: SupporterBadge, CommunityCard: CommunityCard,
    AppBar: AppBar, TabBar: TabBar, ListRow: ListRow, ListGroup: ListGroup,
    PhoneFrame: PhoneFrame, WelcomeScreen: WelcomeScreen, OnboardingScreen: OnboardingScreen, EditionScreen: EditionScreen,
    ArchiveScreen: ArchiveScreen, SettingsScreen: SettingsScreen, PremiumScreen: PremiumScreen, ShabbatScreen: ShabbatScreen,
    ICON_NAMES: Object.keys(ICONS)
  };
  window.Tamzit = Object.assign(window.Tamzit || {}, api);
})();
