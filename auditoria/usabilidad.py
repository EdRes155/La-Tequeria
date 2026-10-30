#!/usr/bin/env python3
"""Auditoría de navegador con datos ficticios y red externa bloqueada.

Requiere Python 3.10+, playwright y Chromium. Ejecutar Vite localmente y usar:
python auditoria/usabilidad.py --base-url http://127.0.0.1:5173
Las comprobaciones reproducen defectos; no certifican accesibilidad ni producción.
"""
import argparse
import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--output', default='auditoria/ux-evidencias')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    origin = urlsplit(args.base_url)
    if origin.hostname not in ('localhost', '127.0.0.1') or origin.scheme != 'http':
        raise SystemExit('Solo se admite un servidor HTTP local de la copia auditada.')
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    fixture = Path(__file__).with_name('ux-fixture.js').read_text()
    evidence = {'environment': 'Chromium, copia local, fixture sintética; sin Supabase real', 'checks': [], 'screenshots': [], 'blocked_external': [], 'page_errors': []}

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
        await context.add_init_script(fixture)

        async def route(request):
            target = urlsplit(request.request.url)
            if target.hostname not in ('127.0.0.1', 'localhost') or target.netloc != origin.netloc:
                evidence['blocked_external'].append(request.request.url.split('?')[0])
                await request.abort()
            elif target.path == '/src/supabaseClient.js':
                await request.fulfill(status=200, content_type='application/javascript', body='export const supabase = window.__UX_SUPABASE__;')
            else:
                await request.continue_()

        await context.route('**/*', route)
        page = await context.new_page()
        page.on('pageerror', lambda error: evidence['page_errors'].append(str(error)))

        async def shot(name):
            await page.wait_for_timeout(180)
            await page.screenshot(path=str(out / (name+'.png')), full_page=True)
            evidence['screenshots'].append(name+'.png')

        async def start(width=390, height=844):
            await page.set_viewport_size({'width':width,'height':height})
            await page.goto(args.base_url, wait_until='networkidle')
            await page.get_by_role('button', name='Administrador de prueba', exact=True).click()
            await page.locator('.pin-input').fill('2468')
            await page.get_by_role('button', name='Entrar', exact=True).click()
            await page.locator('.mesas-grid').wait_for()

        async def mesa():
            await page.locator('.mesa-card').first.click()
            await page.locator('.comanda-wrap').wait_for()

        async def add():
            await page.locator('.item-btn').filter(has_text='Taco Pastor').first.click()

        # 1. Reflujo de la pantalla de mesas y descubribilidad de navegación móvil.
        await start()
        await shot('01-mesas-movil')
        layouts = []
        for width,height in [(320,568),(390,844),(760,1024),(768,1024),(1440,900)]:
            await page.set_viewport_size({'width':width,'height':height})
            layouts.append(await page.evaluate('''() => ({width:innerWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,mainOverflow:document.querySelector('.main').scrollWidth>document.querySelector('.main').clientWidth,navHidden:document.querySelector('.topbar-nav').scrollWidth>document.querySelector('.topbar-nav').clientWidth})'''))
        evidence['checks'].append({'id':'UX-B01','layouts':layouts})

        # 2. Una comanda local se pierde al volver a Mesas.
        await start()
        await mesa()
        await add()
        await shot('02-comanda-movil')
        assert '1' in await page.locator('.pane-toggle').inner_text()
        await page.locator('.type-bar').get_by_role('button',name='Mesas',exact=True).click()
        await mesa()
        lost = 'Órdenes · 0' in await page.locator('.pane-toggle').inner_text()
        assert lost
        evidence['checks'].append({'id':'UX-B02','draft_lost_without_confirmation':lost})

        # 3. La confirmación visible no depende de la escritura exitosa.
        await start()
        await mesa()
        await add()
        await page.evaluate('window.__UX_FIXTURE__.failWrites=true')
        await page.get_by_role('button',name='Enviar a cocina',exact=True).click()
        await page.locator('.toast.ok').wait_for()
        await shot('03-envio-fallido-con-exito')
        success = await page.locator('.toast.ok').inner_text()
        saved = await page.evaluate('window.__UX_FIXTURE__.db.tickets.length')
        assert 'enviada' in success and saved == 0
        evidence['checks'].append({'id':'UX-B03','visible_message':success,'persisted_tickets':saved})

        # 4. En móvil falta la persona activa al mirar el catálogo.
        await start()
        await mesa()
        await add()
        await page.locator('.phone-footer').get_by_role('button',name='Orden',exact=True).click()
        await page.locator('.pane-toggle').get_by_role('button',name='Menú',exact=True).click()
        active_hidden = 'Orden 2' not in await page.locator('.comanda-wrap').inner_text()
        assert active_hidden
        await shot('04-menu-sin-persona-activa')
        await add()
        await page.locator('.pane-toggle').get_by_role('button',name=re.compile('Órdenes')).click()
        assert await page.locator('.orden').count() == 2
        await page.locator('.orden').nth(1).locator('.icon-btn').click()
        assert await page.locator('.orden').count() == 1
        assert await page.locator('.modal-bg').count() == 0
        evidence['checks'].append({'id':'UX-B04','active_order_hidden_in_menu':active_hidden,'nonempty_order_deleted_without_dialog':True})

        # 5. Diálogo domicilio: foco, Escape, etiquetas y nombres de control.
        await start()
        await page.get_by_role('button',name='Domicilio',exact=True).click()
        await page.locator('.modal-dom').wait_for()
        await shot('05-domicilio-movil')
        semantics = await page.locator('.modal-dom').evaluate('''el => ({role:el.getAttribute('role'),ariaModal:el.getAttribute('aria-modal'),fields:Array.from(el.querySelectorAll('input,select')).map(x=>({placeholder:x.getAttribute('placeholder'),associatedLabels:x.labels.length})),iconNames:Array.from(el.querySelectorAll('button.icon-btn')).map(x=>({text:x.textContent.trim(),ariaLabel:x.getAttribute('aria-label')}))})''')
        await page.locator('.modal-dom button').last.focus()
        await page.keyboard.press('Tab')
        escaped_focus = not await page.evaluate("!!document.activeElement.closest('.modal-dom')")
        await page.keyboard.press('Escape')
        still_open = await page.locator('.modal-dom').count() == 1
        assert escaped_focus and still_open
        evidence['checks'].append({'id':'UX-B05','semantics':semantics,'tab_leaves_dialog':escaped_focus,'escape_leaves_dialog_open':still_open})

        # 6. Escritorio: borrador guardado y catálogo con panel de pedido.
        await start(1440,900)
        await mesa()
        await add()
        await shot('06-comanda-escritorio')
        await page.get_by_role('button',name='Guardar sin enviar',exact=True).click()
        await mesa()
        summary = await page.locator('.resumen-actions').inner_text()
        saved = await page.evaluate('window.__UX_FIXTURE__.db.tickets.length')
        assert 'Reenviar a cocina' in summary and saved == 0
        await shot('07-borrador-como-mesa-ocupada')
        evidence['checks'].append({'id':'UX-B06','saved_draft_actions':summary,'persisted_tickets':saved})

        # 7. Estilos computados y tamaños reales de objetivos.
        await start()
        await mesa()
        await add()
        menu_metrics = await page.locator('.pane-scroll').evaluate('el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,productButtons:el.querySelectorAll(".item-btn").length})')
        colors = await page.locator('.col-head').evaluate_all('''els=>els.map(el=>{const s=getComputedStyle(el);return {text:el.textContent,color:s.color,background:s.backgroundColor,fontSize:s.fontSize,fontWeight:s.fontWeight}})''')
        for color in colors:
            def luminance(rgb):
                values = [int(n)/255 for n in re.findall(r'\d+',rgb)[:3]]
                linear = [v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in values]
                return sum(v*w for v,w in zip(linear,[0.2126,0.7152,0.0722]))
            a,b = sorted([luminance(color['color']),luminance(color['background'])])
            color['contrastRatio'] = round((b+0.05)/(a+0.05),2)
        await page.locator('.pane-toggle').get_by_role('button',name=re.compile('Órdenes')).click()
        sizes = await page.locator('.stepper button').evaluate_all('''els=>els.map(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height,text:el.textContent.trim(),ariaLabel:el.getAttribute('aria-label')}})''')
        selected = await page.locator('.orden').first.evaluate("el=>({tag:el.tagName,tabIndex:el.getAttribute('tabindex'),role:el.getAttribute('role')})")
        evidence['checks'].append({'id':'UX-B07','category_styles':colors,'menu_metrics':menu_metrics,'stepper_targets':sizes,'order_selection':selected})

        # 8. Comanda en el límite de cambio móvil/escritorio.
        await start(760,1024)
        await mesa()
        await add()
        boundary = await page.evaluate('''()=>({phonePanels:!!document.querySelector('.pane-toggle'),columns:getComputedStyle(document.querySelector('.comanda')).gridTemplateColumns,menuWidth:document.querySelector('.menu-pane').getBoundingClientRect().width,ticketWidth:document.querySelector('.ticket-pane').getBoundingClientRect().width})''')
        await shot('08-comanda-760px')
        evidence['checks'].append({'id':'UX-B08','boundary':boundary})

        await browser.close()
    (out/'resultados.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(evidence,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    asyncio.run(main())
