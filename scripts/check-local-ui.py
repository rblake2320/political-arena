"""Real local browser regression: navigation, restored playback, upload to draft.
Creates a clearly named synthetic account/campaign/draft in LOCAL state only.
"""
import json
import os
from pathlib import Path
import tempfile
import uuid
import hashlib
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:8797'
results = []
run_id = uuid.uuid4().hex
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(BASE)
        expect(page.get_by_role('status')).to_contain_text('479 loaded', timeout=30000)
        page.get_by_role('link', name='Explore the race directory').click()
        assert page.url.endswith('#race-directory')
        page.get_by_label('Filter races by state').select_option('CA')
        page.get_by_role('link').filter(has_text='2026 California 12th District').click()
        page.get_by_role('button', name='Ads & Rebuttals 4', exact=True).click()
        expect(page.locator('video')).to_have_count(4)
        for video in page.locator('video').all():
            expect(video).to_have_js_property('readyState', 4, timeout=30000)
        page.locator('video').first.press('Space')
        expect(page.locator('video').first).not_to_have_js_property('currentTime', 0)
        results.append({'check': 'restored-media-playback', 'pass': True, 'players': 4})
        page.locator('video').first.press('Space')
        page.get_by_role('button', name='◈ FACT-CHECK & EVIDENCE · THIS AD ▾ OPEN', exact=True).first.click()
        expect(page.get_by_role('button', name='+ Add a fact-check source', exact=True)).to_be_visible()
        page.get_by_role('button', name='Ask question', exact=True).click()
        expect(page.get_by_role('link', name='Sign in to submit a question')).to_be_visible()
        page.get_by_role('button', name='Cancel', exact=True).click()
        results.append({'check': 'directory-tabs-evidence-question-gate', 'pass': True})
        page.goto(BASE + '/race/not-a-real-race')
        expect(page.get_by_role('alert')).to_contain_text('Race unavailable', timeout=15000)
        page.get_by_role('button', name='Retry', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Race unavailable', timeout=15000)
        results.append({'check': 'unknown-race-retry', 'pass': True})

        suffix = uuid.uuid4().hex[:10]
        password = 'Local-test-only-' + uuid.uuid4().hex + '!'
        email = 'ui-' + suffix + '@example.test'
        response = page.request.post(BASE + '/api/auth/register', data={'email':email, 'username':'ui_'+suffix, 'password':password, 'display_name':'LOCAL UI TEST'})
        assert response.ok, response.status
        account = response.json()['data']
        verify = page.request.post(BASE + '/api/auth/verify-email', data={'token':account['dev_verification_token']})
        assert verify.ok
        login = page.request.post(BASE + '/api/auth/login', data={'email':email,'password':password})
        token = login.json()['data']['token']
        created = page.request.post(BASE + '/api/candidates', headers={'Authorization':'Bearer '+token}, data={'race_id':'race-3','name':'LOCAL UI TEST '+suffix,'party':'Independent','biography':'Synthetic local workflow test only.'})
        assert created.ok, created.text()
        # Authenticate through normal login UI, not an injected store.
        page.goto(BASE + '/login')
        page.locator('input[type=email]').fill(email)
        page.locator('input[type=password]').fill(password)
        page.get_by_role('button', name='Sign In', exact=True).click()
        page.wait_for_url(BASE + '/')
        page.goto(BASE + '/race/race-3')
        expect(page.get_by_role('button',name='Post ad',exact=True)).to_be_enabled(timeout=30000)
        page.get_by_role('button',name='Post ad',exact=True).click()
        expect(page.get_by_role('button',name='Choose or drop video, audio, or image')).to_be_visible()
        # Reuse a restored historical test file; do not download unrelated media.
        ads = page.request.get(BASE + '/api/ads/races/race-3').json()['data']['ads']
        media = next(a['media_url'] for a in ads if str(a['media_url']).endswith('.webm'))
        payload = page.request.get(BASE + media)
        assert payload.ok
        with tempfile.TemporaryDirectory(prefix='arena-upload-') as folder:
            fixture = Path(folder) / 'local-roundtrip.webm'
            fixture.write_bytes(payload.body())
            page.locator('input[type=file]').set_input_files(str(fixture))
            expect(page.get_by_role('button',name='Remove media')).to_be_visible(timeout=30000)
            page.get_by_label('Ad title').fill('LOCAL UI UPLOAD TEST '+suffix)
            page.get_by_label('Ad text / transcript').fill('Synthetic local upload roundtrip test; not campaign material.')
            page.get_by_label('FEC disclaimer').fill('LOCAL TEST ONLY. Not a campaign advertisement.')
            with page.expect_response(lambda response: response.url == BASE + '/api/ads' and response.request.method == 'POST') as saved:
                page.get_by_role('button',name='Create draft',exact=True).click()
            expect(page.get_by_text('Ad draft created for moderation.',exact=True)).to_be_visible(timeout=15000)
            draft_id = saved.value.json()['data']['id']
            draft = page.request.get(BASE + '/api/ads/' + draft_id, headers={'Authorization':'Bearer '+token})
            assert draft.ok, draft.status
            record = draft.json()['data']
            assert record['status'] == 'draft', record['status']
            uploaded = page.request.get(BASE + record['media_url'])
            assert uploaded.ok
            assert hashlib.sha256(uploaded.body()).digest() == hashlib.sha256(payload.body()).digest()
        results.append({'check': 'file-import-through-ui-to-draft', 'pass': True})
        # Every top-level public route must render real content, not an empty shell.
        for route, text in [('/help','How Arena Works'),('/what-matters','What Matters'),('/terms','Terms'),('/privacy','Privacy'),('/moderation-policy','Moderation'),('/dmca','Copyright')]:
            page.goto(BASE + route)
            expect(page.locator('main')).to_contain_text(text, timeout=15000)
        results.append({'check': 'public-route-content', 'pass': True, 'routes': 6})
        assert not errors, errors
    finally:
        failure = str(__import__('sys').exc_info()[1] or '')
        Path('.wrangler/ui-check-' + run_id + '.json').write_text(json.dumps({'results':results,'page_errors':errors,'failure':failure},indent=2))
        browser.close()
print(json.dumps(results, indent=2))
