# Synara uyarlamaları: 9. gün

İncelenen dönem: **5 ekim 2026 02:31:58 → 6 ekim 2026 02:31:58**, Europe/Istanbul. Committer zamanına göre bu aralıktaki 27 commitin tamamı incelendi; referans upstream uç commit `a83a6248b1f66541d7233f206ce450f72f80da5f`.

Sonraki inceleme penceresi **6 ekim 2026 02:31:58 → 7 ekim 2026 02:31:58**. Pencereler başlangıç dahil, bitiş hariç; sonraki gün incelenirken o günün commitleri upstream'den güncellenmeli.

Kullanıcının seçtiği öneriler: **1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16**. Aşağıdaki numaralar inceleme tablosundaki öneri numaralarıdır. Seçilen 14 öneri dört task grubunda toplandı.

## Uygulama ve bitirme kuralları

- Upstream commitleri cherry-pick etme. Referans difflerinden yalnız aşağıdaki davranışları al; güncel Glade kodunu ve docsunu yeniden kontrol ederek mevcut sahipliklere uyarla. İki taraftaki sağlam pratikleri kullan, mevcut Glade davranışı zaten daha iyiyse koru.
- Her grup aynı agent'ın tek taskı olarak ele alınabilir. Bu dosya uygulama planıdır; ayrı sohbet açmak veya agent başlatmak için talimat değildir.
- AGENTS.md geçerli: kalıcı gerçek ve yan etkiler server'da, sunum web'de, native işlemler desktop'ta, süreçler arası şekiller contracts'ta. Mevcut servisleri ve bileşenleri genişlet; ikinci state sahibi, controller bag, varsayımsal uyumluluk katmanı veya hatayı gizleyen fallback ekleme.
- Mevcut checkout'ta çalış. Başkasının değişikliklerini koru; yalnız taska ait dosya ve hunkları stage et. Testler çalışırken dosya düzenleme.
- Chat split, terminal sadeleştirmesi, Hub, multi-account veya kaldırılmış ürün akışları ekleme. Mevcut terminal tabları, tile düzeni, drawer/dock sunumları ve provider/session sınırları korunmalı.
- Varsayılan olarak yeni test yazma. Önce mevcut testleri kullan. Ancak somut ve yüksek etkili bir lifecycle, yetki veya protokol açığı mevcut kapsamda korunmuyorsa gerçek sınırda tek sahipli test ekle; neden gerekli olduğunu açıkla. Bug regression testi düzeltmeden önce başarısız olmalı. Retired browser harness'i yeniden kurma.
- Kod değişikliklerini `bun run check` ve ilgili mevcut testlerle doğrula. Süreçler arası veya lifecycle değişikliklerinde tam `bun run test` çalıştır; `bun test` kullanma. Platform/process değişikliklerinde `bun scripts/check-windows-runtime-boundary.ts`; gerekli desktop/packaging değişikliklerinde `bun run build:desktop`; migration gerekirse lineage kontrolü de çalışmalı.
- UI ve runtime davranışlarını gerçek Dev uygulamasında doğrula. Desktop için gerçek launcher kullan. Başka instance çalışıyorsa ayrı home ve kullanılmayan portlarla izole et; kullanıcının veritabanını değiştirme. Çalıştırılmayan kontrolleri geçti diye raporlama.
- Etkilenen aktif docs ve örnekleri kodla birlikte güncelle. Tamamlanan maddeleri burada işaretle; yarım işi tamamlandı sayma.
- **Aksi söylenmedikçe her tamamlanan grup için kullanıcıya görünen değişiklikleri CHANGELOG.md'deki en güncel unreleased sürüme ekle ve işi conventional commit ile commitle.** Sabit bir sürüm numarasına bağlama; uygulama sırasında mevcut en güncel unreleased başlığını kullan. Henüz böyle bir bölüm yoksa numara atamadan `Unreleased` bölümü aç. Released sürüm notlarını değiştirme. Commit yalnız tamamlanan grubun kodunu, ilgili docs/changelog ve TODO durumunu içersin. Body davranış değişikliğini, kontrolleri ve refactor varsa net satır farkını anlatsın. Push bu planın parçası değildir.
- Aşağıdaki changelog metinleri taslaktır; iş gerçekten bitince gerçekleşen davranışa göre düzenle ve mevcut ilgili satırlarla birleştir. Şimdi tamamlanmamış özelliği changelog'a yazma. Küçük/internal değişiklik kullanıcı deneyimini etkilemiyorsa ayrıca satır açma.

## Grup özeti ve paralellik

| Grup | Amaç | Seçilen öneriler |
| --- | --- | --- |
| G1 | Masaüstü ve terminal süreçlerini güvenle açmak/kapatmak | 1, 3, 15, 16 |
| G2 | Uzun Git işlerini bağlantıdan bağımsız ve tek sefer çalıştırmak | 7, 8 |
| G3 | Provider yetkilerini, ses desteğini ve teslimat hatalarını doğru göstermek | 5, 9, 10, 13 |
| G4 | Sohbet yerleşimini ve composer yaşam döngüsünü sağlamlaştırmak | 2, 6, 11, 12 |

Grupların birbirine zorunlu davranış bağımlılığı yok; ayrı sahiplerle paralel yürüyebilirler. G1'in terminal, G2'nin Git ve G3'ün provider işleri ortak RPC kayıtları, transport capability/revision dosyaları veya büyük ortak modüllere dokunabilir. Bu dosyalara eşzamanlı bağımsız edit yapılmasın: değişiklik sahibi belirlenip ortak entegrasyon sıralı yapılsın. G2'de uzun işlem altyapısı ile reconnect recovery aynı task içinde birlikte tasarlanmalı. G4'te approval gösterimi G3'ün yetkilendirme davranışını değiştirmemeli. Shared CHANGELOG.md ve TODO.md hunkları da koordineli güncellenmeli.

## G1: masaüstü ve terminal yaşam döngüsü

- [ ] **1: sahipsiz kilit recovery ve doğru açılış açıklaması.** Referans: [82bb358c42e53b2f99a526ab39851f5a2caa9c80](https://github.com/Emanuele-web04/synara/commit/82bb358c42e53b2f99a526ab39851f5a2caa9c80).
  `apps/server/src/persistence/DatabaseLifecycleLock.ts` içinde yalnız boş veya normal `.DS_Store` dosyasını içeren sahipsiz lock/recovery-guard klasörünün güvenli kaldırılmasını mevcut atomic owner yayınlama akışına ekle. Symlink, bozuk owner metadata, bilinmeyen içerik ve canlı sahip korunmalı; recursive lock silme veya SQLite repair yapılmamalı. Yarışta başka owner yayınlanırsa onu silmeden vazgeç. `apps/desktop/src/backend/backendSupervisor.ts` içindeki dialog, bilinmeyen sahibin kesinlikle başka çalışan server olduğunu iddia etmesin; log konumu ve **Open logs** aksiyonu mevcut native log açma davranışıyla eklensin.

- [ ] **3: renderer erişilemezken native çıkış onayı.** Referans: [99ae45cd757a6459a2f64cc43ed8686f7e0202bd](https://github.com/Emanuele-web04/synara/commit/99ae45cd757a6459a2f64cc43ed8686f7e0202bd).
  `apps/desktop/src/main/lifecycle/desktopShutdown.ts` ve `runningChatsQuitGuard.ts` üzerinden, onay gerektiren çıkışta renderer yok/çökmüşse native dialog göster. Tek in-flight onay sahibi olsun; tekrar çıkış istekleri aynı kararı beklesin. İptal veya dialog hatası çıkış izni sayılmasın. Renderer'dan çalışma listesini alamamak boş liste kanıtı değildir. Mevcut normal çıkış, update/install ve graceful shutdown kurallarını koru; upstream'in her idle quit veya macOS pencere kapatmasını onaylatan ürün tercihini ekleme.

- [ ] **15: otomatik terminal girdisi için server'da idle doğrulama.** Referans: [84daea24887fbbe56c26236b92c959a79f49b99c](https://github.com/Emanuele-web04/synara/commit/84daea24887fbbe56c26236b92c959a79f49b99c).
  Terminal sahibi ve `packages/contracts/src/terminal/terminal.ts` üzerinden otomatik yazma işleminin yalnız doğrulanmış idle session'a gitmesini sağla. `apps/web/src/components/useSidebarThreadCommands.tsx` içindeki “terminalde aç” gibi otomatik `cd` gönderen çağrıları bu sınıra taşı; diğer otomatik yazma çağrılarını da incele. Başlamış subprocess/managed agent, denetim sırasında gelen kullanıcı girdisi veya doğrulanamayan process snapshot halinde otomatik yazmayı reddet. İşlem öncesi yeni snapshot al; eski in-flight poll sonucunu izin kanıtı sayma. Kilit ve session kimliğiyle kontrol/yazma yarışlarını koru, shared platform/process yeteneklerini kullan. Normal kullanıcı PTY yazıları bu kısıta tabi olmamalı; istemcideki running bilgisi yalnız UX ipucu olsun.

- [ ] **16: terminal kapanışı onaylanmadan görünümü yok etme.** Referans: [84daea24887fbbe56c26236b92c959a79f49b99c](https://github.com/Emanuele-web04/synara/commit/84daea24887fbbe56c26236b92c959a79f49b99c).
  `apps/web/src/components/terminal/terminalSession.ts`, `apps/web/src/hooks/useTerminalSurfaceController.ts` ve terminal store çağrılarını await edilebilir structured close etrafında düzenle. Kullanıcının açık kapatma isteğinde server başarılı olmadan tile/tab kaldırılmasın, xterm dispose edilmesin ve history temizlenmesin. Başarısızlık görünür olmalı ve terminal kullanılabilir kalmalı; başarısız close'u programa `exit` yazmaya çevirme. Zaten çıkmış süreçlerin yerel cleanup'ını ayrı ele al. Geç tamamlanan close yeni/reopened session'ı dispose etmesin. Tek terminale geçiş, split/tab migration veya upstream layout değişiklikleri kapsam dışı.

**Doğrulama:** mevcut database lock ve quit guard coverage'ını incele; izole home'da Finder-only lock recovery, canlı/bilinmeyen owner koruması, renderer erişilemez çıkışın kabul/iptali ve tekrar istekleri doğrulanmalı. Terminalde çalışan komut, eşzamanlı yazma, başarısız process denetimi, close RPC hatası ve başarılı tile kapatma görülmeli; diğer tile'lar korunmalı. İlgili docs: `docs/desktop-runtime.md`, `docs/windows-runtime.md`, `docs/transport.md`.

**Bitince changelog taslakları:**

- Fixed: “Glade can recover abandoned startup locks containing only Finder metadata, with clearer explanations and access to logs when ownership cannot be verified.”
- Fixed: “Quitting asks for confirmation when the app window cannot respond.”
- Fixed: “Automatic terminal navigation avoids busy shells, and failed closes keep the terminal available.”

## G2: uzun ve yeniden bağlanılabilen Git işlemleri

- [ ] **7: uzun Git yazmalarında süre ve çıktı yönetimi.** Referans: [eb2c74ff31d05b4aea4f3bf6f8327b3326f73c8d](https://github.com/Emanuele-web04/synara/commit/eb2c74ff31d05b4aea4f3bf6f8327b3326f73c8d).
  `apps/server/src/git/Layers/GitCommands.ts`, `GitCore.ts`, `GitBranches.ts`, `GitManager.ts` ve `apps/server/src/git/sourceControlActions.ts` içindeki gerçek yazma çağrılarını incele. Push/commit hook gibi sağlıklı uzun işleri kısa sabit deadline yüzünden öldürmeyen, scoped teardown ve iptali koruyan işlem politikası kur. Okuma/probe deadline'larını gelişigüzel kaldırma. Transfer ve hook çıktısını bounded tutarken pipe'ları tüketmeye devam et; yüksek log hacmi işlemi tek başına başarısız kılmasın. Progress güncel ve sınırlı olmalı, gerçek subprocess hatası saklanmamalı. Mevcut büyük diff üretim bütçelerini, snapshot doğrulamasını, repository mutation kilitlerini ve draft korumasını koru.

- [ ] **8: reconnect'te aynı Git işine bağlanma.** Referans: [eb2c74ff31d05b4aea4f3bf6f8327b3326f73c8d](https://github.com/Emanuele-web04/synara/commit/eb2c74ff31d05b4aea4f3bf6f8327b3326f73c8d).
  Git action sahibi server lifecycle'ında yaşasın; WebSocket abonesinin kopması mutasyonu yeniden başlatmasın. `apps/server/src/server/ws/wsRpc.ts`, ilgili Git contracts ve `apps/web/src/wsTransport.base.ts`/implementation üzerinden özgün action identity ile progress/sonuç reattach ekle. Kimlik aynı yetkili caller ve input fingerprint'e bağlansın; aynı ID ile farklı içerik veya başka kullanıcı reddedilsin. Süren iş, subscriber ve sınırlı terminal sonuç retention'ı ayrı sahipliklere sahip olsun; server shutdown ve yetki iptali işleri doğru sonlandırsın. Reconnect otomatik olarak commit/push/PR çağrısını yeniden göndermesin. Server yeniden başladıysa veya sonuç yoksa belirsizliği açık gösterip repo kontrolü iste; bilinmeyen sonucu başarısız veya başarılı diye uydurma. Gerekli capability/revision değişikliğini mevcut negotiation üzerinden yap; spekülatif kalıcı job sistemi kurma.

**Doğrulama:** mevcut Git, transport recovery ve WS authorization testlerini kullan. İzole repo/process ortamında uzun hook ve yüksek çıktının doğru tamamlanması, işlem sürerken bağlantı kopup aynı server'a dönülmesi, tek mutasyon, input/caller uyuşmazlığı, progress/sonuç retention sınırı, shutdown/iptal ve server restart sonrası belirsiz sonuç doğrulanmalı. UI navigasyonu yakalanmış işlem sahipliğini değiştirmemeli; gerçek Git hatasının phase/detail bilgisi korunmalı. İlgili docs: `docs/git-generation.md`, `docs/transport.md`.

**Bitince changelog taslağı:**

- Improved: “Long Git operations keep their progress across reconnects without starting the same action twice.”

## G3: provider, ses ve teslimat sınırları

- [ ] **5: HTTP ses yanıtını ortak şemayla doğrula.** Referans: [9f329d3b08c96351a152a35f155e52eb644c8d5a](https://github.com/Emanuele-web04/synara/commit/9f329d3b08c96351a152a35f155e52eb644c8d5a).
  `apps/web/src/wsNativeApi.ts` içindeki başarılı upload yanıtını mevcut `ServerVoiceTranscriptionResult` şemasıyla decode et. Primitive, yanlış `text` türü, bozuk JSON ve eksik zorunlu alanlar composer'a geçmeden anlaşılır hata vermeli. Mevcut 404/405 route-unavailable RPC fallback ve body cancellation korunsun; başka hatada veya bozuk başarılı response'ta ikinci transcription request gönderilmesin. Draft ve ses akışının hata yönetimi korunsun.

- [ ] **9: Codex düz metin login çıktısından doğru voice capability.** Referans: [15f994983f81167c3c71fdf955d471970cb8389e](https://github.com/Emanuele-web04/synara/commit/15f994983f81167c3c71fdf955d471970cb8389e).
  `apps/server/src/provider/Layers/ProviderHealth.ts` içinde başarılı stdout/stderr'deki açık ChatGPT login ifadesini tanı ve voice capability'yi true yap; açık API-key girişinde false olsun. Bilinmeyen başarılı çıktı authenticated kalabilir fakat voice desteği icat edilmesin. Mevcut JSON auth parsing'i, capability kaynak sahipliğini ve iki provider'ın UI davranışını koru.

- [ ] **10: karantinaya alınan teslimatın nedenini hemen yüzeye taşı.** Referans: [01c7086695540bdce8607601af455f62beb5b8b8](https://github.com/Emanuele-web04/synara/commit/01c7086695540bdce8607601af455f62beb5b8b8).
  `apps/server/src/orchestration/providerCommands/intentSource.ts` içindeki terminal delivery settlement/quarantine akışında durable hata nedenini kanonik session/read model'e hemen yansıt. Gecikmiş projection yerine durable session kimliğini doğrula; conditional update yeni session'ın hatasını, çalışan turun status'unu veya activeTurnId'sini ezmesin. UI'da sebep yeni mesaj gönderme denemesi gerektirmeden görülsün; session yoksa da hatanın erişilebilir yolu olsun. Mevcut explicit recovery/unblock anlamını koru: belirsiz teslimatı otomatik yeniden gönderme veya sessizce temizleme. Restart'ta kalmış blocker için aynı açıklamanın görünürlüğünü incele.

- [ ] **13: Full Access'te yetkili kendi MCP çağrısının ek provider onayı.** Referans: [99eb004d3826353cc0390b90030196c84fd6e17a](https://github.com/Emanuele-web04/synara/commit/99eb004d3826353cc0390b90030196c84fd6e17a).
  `apps/server/src/provider/codex/codexAppServerManager.ts` ve mevcut gateway permission modülleri üzerinden yalnız Full Access, doğru MCP server/katalog, geçerli lease ve aynı aktif native thread/turn için tek çağrılık kabul ekle. Araç adını yalnız benzer prefix'ten güvenilir sayma; mevcut gerçek katalog/permission doğrulamasını kullan. Başka MCP server, eski turn, retired credential, stopping session ve daha kısıtlı access mode kabul kapsamına girmesin. Gateway authorization, computer/device consent, revocation ve başka sohbete mesaj gibi açık insan yetkisi gerektiren kurallar her çağrıda yürüsün. Kalıcı grant veya kaldırılmış Hub/coordinator seçeneği ekleme; mevcut computer davranışını koru.

**Doğrulama:** mevcut voice HTTP, ProviderHealth, provider delivery ve gateway/approval coverage'ını kullan. Bozuk successful response'ta tek request, ChatGPT/API-key/unknown auth ayrımı, karantinaya girer girmez görünen detail, yeni session yarışında korunmuş durum ve izin matrisini doğrula. Dev'de uygun gerçek hesapla ses düğmesinin görünürlüğünü ve hata sunumunu kontrol et; canlı provider doğrulanmadıysa açıkça raporla. İlgili docs: `docs/provider-architecture.md`, `docs/transport.md`; ürün davranışı değişirse `docs/glade-feature-scope.md`.

**Bitince changelog taslakları:**

- Fixed: “Voice dictation recognizes supported Codex sign-ins and reports invalid transcription responses clearly.”
- Fixed: “Chats explain provider delivery blocks as soon as they occur.”
- Improved: “Full Access avoids redundant approval prompts for authorized Glade tools.”

## G4: transcript ve composer güvenilirliği

- [x] **2: boyut değişmeden bozulan satır konumlarını yakala.** Referans: [b92ff89166a4e5fdc903276502305d159555e037](https://github.com/Emanuele-web04/synara/commit/b92ff89166a4e5fdc903276502305d159555e037).
  `apps/web/src/components/chat/useTimelineRowOverlapGuard.ts` içindeki mevcut konum düzeltme sahibini border-box gözlemiyle genişlet. Batched render'ın sonradan yazdığı container konumunu da yakala; boyut değişimi olmaması gözlemi engellemesin. Kendi style düzeltmelerinin observer feedback loop'una dönüşmesini ve unmounted container takibini önle. Ölçüm/yazmaları uygun biçimde grupla. Yeni virtualizer kurma; gerçek assistant metnine bağlı auto-follow'u yerleşim ölçümüyle birleştirme.

- [x] **6: mesaj navigasyonu için gerçek transcript boşluğunu kullan.** Referans: [7ec6c1d7db19ee172b31edd2e043a8b4d7fcd404](https://github.com/Emanuele-web04/synara/commit/7ec6c1d7db19ee172b31edd2e043a8b4d7fcd404).
  `apps/web/src/components/chat/MessageTrail.tsx` ve layout bağlantısında sabit panel genişliği eşiği yerine ayarlanmış chat max-width, dock inset ve gerçek rail boşluğunu dikkate al. Yeterli boşluk yoksa rail gizlensin; sağ panel açılış/kapanışı ve kullanıcı font/width ayarı metin üstüne binmeye yol açmasın. Gizlenen rail/tooltip klavye odağını hapsetmesin. Mevcut tooltip yüzeyini ve disclosure/reduced-motion kurallarını kullan; gereksiz yeni effect/memoization veya layout state kopyası ekleme.

- [x] **11: composer image queue için doğru generation/lifetime.** Referans: [d408f3432efb99b33c106a593285839e6343d1da](https://github.com/Emanuele-web04/synara/commit/d408f3432efb99b33c106a593285839e6343d1da).
  `apps/web/src/hooks/useComposerImageIntake.ts` içinde StrictMode cleanup/setup tekrarında aynı queue yeniden kullanılabilsin. Önceki generation'ın başarılı/hatalı/finally sonucu yeni kuyruğun pending sayısını veya görsellerini değiştirmesin. Dispose sırasında tail/pending durumu doğru sıfırlansın ve subscription yaşam döngüsü korunsun. Thread değişimi, unmount ve iptal edilen preparation için blob URL/resource cleanup'ını koru; attachment sırası ve yeni draft içeriği kaybolmasın.

- [x] **12: rutin kabul edilmiş approval sonuçlarını görünümde süz.** Referans: [d408f3432efb99b33c106a593285839e6343d1da](https://github.com/Emanuele-web04/synara/commit/d408f3432efb99b33c106a593285839e6343d1da).
  `apps/web/src/workLog.entries.ts` ve mevcut tool/approval normalization üzerinden yalnız normal, hata olmayan, tek çağrılık accepted approval resolution satırlarını gereksiz görünümden çıkar. Ret, cancel, error, geniş/persistent grant ve bütün computer/device consent kayıtları görünür kalsın; clipboard gibi task scope içermeyen computer araçları da korunmalı. Durable activity kaydını veya provider onay kararını değiştirme; tool detayları ve pending approval erişilebilir olsun. G3'teki auto-approval davranışından ayrı, yalnız sunum kararı olarak uygula.

**Doğrulama:** mevcut image intake ve ilgili transcript/work-log coverage'ını kullan. Dev'de StrictMode, thread değiştirirken hazırlanan görsel, art arda intake, eski preparation'ın geç tamamlanması ve URL cleanup'ını kontrol et. Streaming/tool disclosure sırasında toplu güncellemelerde satır çakışması, geniş/dar chat ayarı, sağ dock hareketi, farklı font boyutu, reduced motion ve rail klavye odağı görülmeli. Kabul satırları sadeleşirken ret/hata/geniş yetki ve computer/device consent detayları erişilebilir kalmalı. Etkilenen mevcut chat/composer docsunu güncelle.

**Bitince changelog taslakları:**

- Fixed: “Conversation rows stay correctly positioned as activity details change, and message navigation stays clear of the text.”
- Fixed: “Image attachments remain reliable when the composer is remounted or preparation finishes after switching chats.”
- Improved: “Chat activity hides routine accepted approval results while keeping important permission decisions visible.”
