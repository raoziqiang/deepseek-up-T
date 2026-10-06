/**
 * The "Desktop whale charm" preference row.
 *
 * This is a dynamic Cordis client plugin: it contributes one row to the General
 * settings page that lets the user detach the whale charm from the window and
 * float it on the desktop as a real always-on-top window.
 *
 * The row is only useful in the Electron desktop shell, where the `dshDesktop`
 * bridge exists. In a plain browser session the row renders disabled with an
 * explanation instead of pretending the feature is available.
 *
 * Client half: this module. It is loaded as a Cordis client entry, so it uses the
 * restricted `ctx` builtins (`React`, `styles`, `ctx.get`) and never touches the
 * Host's data model.
 */

export const name = 'whale-charm-settings'

export function apply(ctx) {
  const React = ctx.get('React')
  const styles = ctx.get('styles')
  const slots = ctx.get('slots')
  if (React === undefined || styles === undefined || slots === undefined) return

  // ── The bridge contract ────────────────────────────────────────────────────
  // These are the channels added to the desktop shell by tools/patch-main.mjs.
  const CHARM_STATE = 'dsh-desktop:charm-state'
  const CHARM_ACTION = 'dsh-desktop:charm-action'

  /**
   * The desktop shell exposes `dshDesktop`; the charm channels are invoked
   * through a tiny shim that the desktop preload publishes when it is present.
   * When it is absent, the whole feature is unavailable.
   */
  const charmApi = () => {
    const bridge = globalThis.dshWhaleCharm
    if (bridge === undefined || bridge === null) return null
    return bridge
  }

  const disposeStyles = styles.insert(`
    .whale-charm-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; }
    .whale-charm-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .whale-charm-title { font-size: 14px; line-height: 22px; font-weight: 500; }
    .whale-charm-desc { font-size: 12px; line-height: 18px; opacity: 0.68; }
    .whale-charm-switch { flex: none; position: relative; width: 40px; height: 22px; border-radius: 11px; border: 0;
      background: rgba(127,130,135,0.35); cursor: pointer; transition: background 160ms ease-out; }
    .whale-charm-switch[data-on="true"] { background: rgb(65,118,230); }
    .whale-charm-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
      border-radius: 50%; background: #fff; transition: transform 160ms ease-out; }
    .whale-charm-switch[data-on="true"]::after { transform: translateX(18px); }
    .whale-charm-switch:disabled { opacity: 0.45; cursor: not-allowed; }
    .whale-charm-switch:focus-visible { outline: 2px solid rgb(96,165,250); outline-offset: 2px; }
  `)
  ctx.effect(() => disposeStyles)

  /** Localized copy; falls back to English when the locale has no entry. */
  const copy = {
    'zh-CN': {
      title: '桌面鲸鱼挂件',
      desc: '把启动动画留下的小鲸鱼挂到桌面，随时可以拖到任意位置。',
      unavailable: '仅在 Harness 桌面版中可用。',
      failed: '无法切换桌面挂件，请重试。',
    },
    en: {
      title: 'Desktop whale charm',
      desc: 'Float the little whale from the splash onto your desktop, and drag it anywhere.',
      unavailable: 'Available in the Harness desktop app only.',
      failed: 'Could not toggle the desktop charm. Please try again.',
    },
  }

  function useCopy() {
    const [locale, setLocale] = React.useState(() => {
      const service = ctx.get('locale')
      return service?.getLocale?.().id ?? 'en'
    })
    React.useEffect(() => {
      const service = ctx.get('locale')
      if (service === undefined) return undefined
      return service.subscribe(() => setLocale(service.getLocale().id))
    }, [])
    return copy[locale] ?? copy.en
  }

  /** Read and toggle the charm preference through the desktop shell. */
  function useCharm() {
    const api = charmApi()
    const [enabled, setEnabled] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [failed, setFailed] = React.useState(false)

    React.useEffect(() => {
      if (api === null) return undefined
      let active = true
      api.state().then((value) => {
        if (active) setEnabled(value === true)
      }).catch(() => {})
      return () => { active = false }
    }, [api])

    const toggle = React.useCallback(() => {
      if (api === null || busy) return
      setBusy(true)
      setFailed(false)
      api.set(!enabled).then((value) => {
        setEnabled(value === true)
      }).catch(() => {
        setFailed(true)
      }).finally(() => {
        setBusy(false)
      })
    }, [api, busy, enabled])

    return { available: api !== null, enabled, busy, failed, toggle }
  }

  function WhaleCharmRow() {
    const text = useCopy()
    const charm = useCharm()

    const description = charm.available
      ? text.desc
      : `${text.desc} ${text.unavailable}`

    return React.createElement(
      'div',
      { className: 'whale-charm-row' },
      React.createElement(
        'div',
        { className: 'whale-charm-copy' },
        React.createElement('span', { className: 'whale-charm-title' }, text.title),
        React.createElement(
          'span',
          { className: 'whale-charm-desc' },
          charm.failed ? text.failed : description,
        ),
      ),
      React.createElement('button', {
        type: 'button',
        className: 'whale-charm-switch',
        role: 'switch',
        'aria-checked': charm.enabled,
        'aria-label': text.title,
        'data-on': String(charm.enabled),
        disabled: !charm.available || charm.busy,
        onClick: charm.toggle,
      }),
    )
  }

  // Contribute the row to the General settings page.
  ctx.effect(() => slots.inject('settings.general.item', () => {
    const dispose = slots.register({
      id: 'whale-charm',
      order: 60,
      label: () => 'Desktop whale charm',
    }, () => React.createElement(WhaleCharmRow))
    return dispose
  }))
}
