# Performans planı

İnceleme tarihi: **6 ekim 2026**. Kaynak: Windows'ta source control, history ve explorer'ın 15-20 saniye sürmesi üzerine yapılan platform taraması. Bulgular dört paralel taramada çıkarıldı, ardından altı grup halinde güncel koda karşı yeniden doğrulandı. İlk taramadaki birkaç iddia yanlış veya abartılı çıktı; aşağıdaki metin düzeltilmiş halidir.

Kullanıcının seçtiği bulgular: **1-9, 11-28** (10: masaüstü açılış adımlarının backend'den önce sırayla beklenmesi kapsam dışı). Doğrulama sırasında ortaya çıkan ek bulgular (harfle işaretli) ilgili gruba eklendi. Seçilen 27 bulgu ve ekler altı task grubunda toplandı.

Her maddenin bir sınıfı var:

- **düzelt:** hata veya doğruluk sorunu; doğrudan yapılır.
- **iyileştir / refactor:** davranış korunarak maliyet düşürülür.
- **ölç-sonra-karar:** önce belirtilen ölçüm yapılır, sonuç maddenin altına yazılır. Eşik aşılmazsa madde kapanır, kod değişmez.
- **ellenmeyecek:** bilinçli tasarım veya güven sınırı; gerekçesi yazılıdır. Bu maddelere dokunulmaz.

## Uygulama ve bitirme kuralları

- AGENTS.md geçerli: kalıcı gerçek ve yan etkiler server'da, sunum web'de, native işler desktop'ta, süreçler arası şekiller contracts'ta. Mevcut servisleri genişlet; ikinci state sahibi, controller bag, uyumluluk katmanı veya hatayı gizleyen fallback ekleme. Refactorlar net satır azaltmalı.
- Performans iddiası ölçüm ister. "Ölç-sonra-karar" maddelerinde önce/sonra değerini bu dosyaya yaz; ölçmeden "hızlandı" deme. Windows, Linux veya macOS'a özgü maddeleri o platformda doğrula; doğrulanamadıysa açıkça raporla.
- Güven sınırları performans uğruna gevşetilmez: realpath containment, `core.fsmonitor=false`, credential'ların diske yazılmaması, process teardown'un sızıntısızlığı.
- Mevcut checkout'ta çalış. Başkasının değişikliklerini koru; yalnız taska ait dosya ve hunkları stage et. Testler çalışırken dosya düzenleme.
- Varsayılan olarak yeni test yazma. Aşağıda adı geçen testler, mevcut kapsamın korumadığı kalıcı veri, lifecycle veya doğruluk açıklarıdır; regression testi düzeltmeden önce başarısız olmalı. Başka test eklemek için AGENTS.md'deki dört soruyu cevapla.
- Kod değişikliklerini `bun run check` ve ilgili mevcut testlerle doğrula (`bun run test`, asla `bun test`). Lifecycle, persistence veya süreçler arası değişikliklerde tam `bun run test`. Platform/process değişikliklerinde `bun scripts/check-windows-runtime-boundary.ts`; desktop/packaging değişikliklerinde `bun run build:desktop`; migration olursa `bun scripts/check-migration-lineage.ts`.
- UI ve runtime davranışını gerçek Dev uygulamasında doğrula; desktop için gerçek launcher. Başka instance çalışıyorsa ayrı home ve kullanılmayan portlarla izole et. Ölçümleri kullanıcının veritabanında değil, kopyası üzerinde yap.
- Etkilenen aktif docs'u kodla birlikte güncelle. Tamamlanan maddeleri burada işaretle; yarım işi tamamlandı sayma.
- **Aksi söylenmedikçe her tamamlanan grup için kullanıcıya görünen değişiklikleri CHANGELOG.md'deki en güncel unreleased sürüme ekle ve işi conventional commit ile commitle.** Body davranış değişikliğini, ölçüm sonuçlarını, kontrolleri ve refactorsa net satır farkını anlatsın. Push bu planın parçası değildir.
- Changelog metinleri taslaktır; gerçekleşen davranışa göre düzenle ve mevcut satırlarla birleştir. Ölçümle kapanan veya internal kalan maddeler için satır açma.

## Grup özeti ve paralellik

| Grup | Amaç                                                         | Bulgular                      |
| ---- | ------------------------------------------------------------ | ----------------------------- |
| P1   | Git süreç hattını bekletmeyen ve tekrarlamayan hale getirmek | 3, 6, 7, 16, 17 + A-E         |
| P2   | Explorer, workspace araması ve watcher'ları ucuzlatmak       | 13, 22, 26 + F-I              |
| P3   | Orchestration hot path, persistence ve checkpoint maliyeti   | 4, 14, 15, 28 + J             |
| P4   | Web istemcisinde gereksiz yenileme ve render maliyeti        | 1, 2, 20, 21, 27 + K-N        |
| P5   | Provider keşfi ve process probe'ları                         | 5, 12, 18, 19, 23, 24, 25 + O |
| P6   | Masaüstü açılışı ve terminal kalıcılığı                      | 8, 9, 11 + Q-U                |

**Sıra ve çakışmalar:**

- P1 önce gelir. P2'nin watcher ve kuyruk önceliği maddeleri, P4'ün #1, L ve M maddeleri P1'in kuyruk ve watcher davranışına dayanır; P1 değiştiyse onları yeniden doğrula.
- Ortak dosyalar sıralı birleştirilir, eşzamanlı düzenlenmez:
  - `apps/server/src/git/Layers/GitCommands.ts`: P1 (ağ şeridi) ve P2 (explorer önceliği).
  - `apps/server/src/git/Layers/GitStatusBroadcaster.ts`: P1 (#16, A) ve P2 (watcher filtresi).
  - `apps/server/src/orchestration/Layers/CheckpointReactor.ts`: P2 (index invalidation) ve P3 (#14).
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`: P3'te J ve #15.
  - `apps/server/src/terminal/Layers/Manager.ts` (2300+ satır): P5 (#23) ve P6 (#11) aynı `disposeInternal` yolunu kullanır. Bu dosyaya yeni mantık eklemek yerine ilgili modüllere (`windowsProcessSnapshot.ts`, terminal persist) taşı.
  - `apps/server/src/git/Layers/GitManager.ts` (~2000 satır) ve `GitDiff.ts` (~930 satır) sınırda veya üstünde; bu plandan oraya net ekleme yapma.
  - `apps/web/src/routes/-streamBatching.ts`: P4'te #20 ve L ayrı commitlerde.
- Shared CHANGELOG.md ve PERF.md hunkları koordineli güncellenir.

## P1: Git süreç hattı

Çalışma ağacında bu planın öncesinden **commit edilmemiş** bir düzeltme var: `GitCore.statusDetails` artık `refreshUpstream: "await" | "background" | "none"` alıyor; `GitManager.status` ve `GitDiff.resolveBranchMergeBase` stale-upstream fetch'ini beklemiyor. `packages/shared/src/platform/platformProcess.ts` Windows'ta çıplak komut çözümünü cache'liyor. CHANGELOG'da buna ait bir satır var. P1 bu değişiklikle başlar ve onu tamamlar.

- [ ] **A: kalan bekleyen fetch'i kaldır (düzelt).**
      `GitStatusBroadcaster.ts:133` `getStatus` hâlâ varsayılan `"await"` ile `statusDetails` çağırıyor; cache tazeyken RPC ve stream snapshot 15 saniyeye kadar fetch bekleyebiliyor. `"background"` yap. Aynı commit'te `GitDiff.resolveBranchMergeBase` yalnız `upstreamRef`/`branch` kullandığı halde tam status okuyor; `metadataOnly: true` ekle. Mevcut commit edilmemiş değişiklikle birlikte commitle.

- [ ] **16: watcher event'inde aynı porcelain status iki kez çalışıyor (iyileştir).**
      `GitStatusBroadcaster.ts:180-186` önce `statusDetails`, sonra `summary` çalıştırıyor; ikisi de aynı `readPorcelainStatus`'u yapıyor ve single-flight cache (`ttlMs: 0`) yalnız eşzamanlı çağrıları birleştiriyor. İkisini `Effect.all(..., { concurrency: "unbounded" })` ile birlikte başlat; mevcut birleştirme tek süreç üretir. `summary`'yi details'tan türetme: upstream'siz dalda `aheadCount` anlamı farklı (`computeAheadCountAgainstBase`).

- [ ] **7: git ağ işlemleri etkileşimsiz çalışmıyor (düzelt).**
      Non-interactive env yalnız `project/githubProjectProvisioning.ts:381-399`'da ve iki farklı kümeyle var. `Services/GitCommands.ts`'te `GIT_WRITE_EXECUTION`'ın yanına tek `NON_INTERACTIVE_GIT_ENV` sabiti ekle (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`). Status fetch'i, checkout sonrası arka plan fetch'i ve provisioning bunu kullansın. Kullanıcının başlattığı push/pull/fetch yalnız `GIT_TERMINAL_PROMPT=0` alsın: Windows'ta GCM giriş penceresi oturum açmanın tek yolu olabilir. `core.sshCommand`'ı ezmemek için SSH `BatchMode` ekleme. Yazma işlemlerine timeout eklemek **ellenmeyecek**: uzun hook'ların tamamlanması bilinçli bir sözleşme; takılmanın çözümü ayrı bir iptal arayüzü.

- [ ] **17: upstream fetch cache'i worktree başına (iyileştir).**
      `GitStatus.ts:44-46, 320` anahtarda `cwd` kullanıyor; aynı reponun N worktree'si N ağ fetch'i yapıyor. `RepositoryMetadata`'ya zaten hesaplanan `commonDir`'i ekle (`GitRepositoryMetadata.ts:82`); cache ve backoff anahtarı `commonDir + remoteName + upstreamBranch + upstreamRef` olsun, fetch `cwd=commonDir` ile çalışsın. Watcher common dir'i izlediği için tüm worktree'ler yeniden yayın yapar. `"await"` yolundaki `completedAt >= startedAt` anlamını koru.

- [ ] **6: ağ ve gh işleri yerel git'i aç bırakıyor (iyileştir).**
      `GitProcessQueue` zaten foreground/background önceliğine sahip, ama `GitStatus.ts:124-125` tüm status okumalarını ve status fetch'ini aynı arka plan şeridinde çalıştırıyor; gh (`GitHubCli.ts:329`), PR araması ve workspace index de orada. 15 saniyelik fetch'ler 6 iznin tamamını tutabilir; A'dan sonra arka plan fetch'leri daha sık. `GitCommands` içinde ikinci bir `GitProcessQueue` örneği (ağ şeridi) aç; `ExecuteGitInput` ve `withPermit` `lane: "local" | "network"` alsın. Fetch'ler, gh ve kullanıcı push/pull/fetch'leri ağ şeridine; kullanıcı işlemleri foreground önceliğini korusun. Şerit kapasitesine 3 ile başla, ölçerek ayarla.

- [ ] **3: untracked her dosya için ayrı git süreci (iyileştir).**
      `GitDiff.ts:197-235` her untracked dosya için `diff --no-index --numstat` çalıştırıyor (4 eşzamanlı); web bunu turn sürerken 4 saniyede bir istiyor (`useRepoDiffTotals.ts:26`). Yamalar da (`:127-190`) dosya dosya üretiliyor. Küçük bir modül ekle (`apps/server/src/git/gitIntentToAddIndex.ts`): gerçek indeksin geçici kopyasına `add -N --pathspec-from-file --pathspec-file-nul` (Windows komut satırı sınırı), ardından tek `diff --numstat -z --no-renames --no-ext-diff`. `ref` kapsamında mevcut `withRefIndex` indeksini kullan. `ls-files` listesi ve iç içe repo filtresi kalır. Korunacaklar: binary'de `-`, `core.bigFileThreshold`, `.gitattributes binary`, `--no-renames` (yoksa untracked + silinen dosya rename görünür). Yamaları da tek `diff --patch`'e taşımak yalnız kod kısalıyorsa ikinci adım olsun; başlık ve sıralama değişir.
      **Kritik test boşluğu:** hiçbir test `readDiffStats` untracked sayımlarını kapsamıyor. Değişiklikten önce `GitCore.test.ts`'e tek bir tablo testi yaz ve mevcut kodda geçtiğini gör: metin, sonu yeni satırsız, boş, binary, `binary` attribute'lu dosya, iç içe repo, `includeUntrackedFiles`.

- [ ] **B: PR araması status'u bekletiyor (ölç-sonra-karar).**
      `GitManager.ts:1296` cache ıskalanırsa gh çağrısını status snapshot'ından önce bekliyor. Ölç: soğuk snapshot süresinde `pullRequestForBranch` payı ve ıskalama oranı. Anlamlıysa `gitManager.status` sözleşmesine dokunma; yalnız broadcaster'ın stream snapshot yolu önce yerel remote parçasını (bayat PR ile) yayınlasın, PR'ı fork'layıp `remoteUpdated` yayınlasın. `remote: null` gönderme: `mergeGitStatusParts` bunu `hasUpstream: false` sayar ve Publish düğmesi titrer. `refreshStatus` senkron kalsın, rate-limit hatası yayılsın.

- [ ] **C: global metadata kilidi (ölç-sonra-karar).**
      `GitRepositoryMetadata.ts:52,62` tüm repolar için tek `Semaphore(1)`; ıskalamada kilit kuyruğu bekleyen 3 git süreci boyunca tutuluyor ve #6'yı büyütüyor. Ölç: kilit bekleme süresi, stamp süresi, izlenen yol sayısı (çok remote dallı repo + N worktree). Gerekirse global kilit yerine mevcut `makeKeyedSingleFlightCache` ile cwd başına tek uçuş.

- [ ] **D: tam status'un dosya başına okuması ve `add -A`'sı (ölç-sonra-karar).**
      `GitStatus.ts:641-657` dosya başına `readFile` ve `:140-186` temp indekse `add -A` (untracked dosyaları gerçek object store'a yazar) yalnız `metadataOnly` olmayan, yani eylem yollarında çalışıyor; broadcaster'da değil. #3'teki yardımcıyla `add -N` + `diff HEAD --numstat --find-renames` ikisinin de yerini alabilir; ancak intent-to-add dosyalarında rename tespitinin bugünkü move-aware çıktıyla aynı olduğu önce testle kanıtlanmalı. Büyük untracked kümesinde eylem süresini ölçmeden başlama.

- [ ] **E: `--no-optional-locks` ve `--untracked-files=all` (ellenmeyecek).**
      Optional lock'ların kapalı olması kullanıcının kendi git'iyle `index.lock` çakışmasını önlüyor; `=all` `workingTree.files` listesi için şart. #16'daki birleştirme de argümanların aynı olmasına dayanıyor.

**Doğrulama:** `bun run check`, `bun run --cwd apps/server test src/git`, `bun scripts/check-windows-runtime-boundary.ts` (#6, #7), bitirirken tam `bun run test`. Dev'de çok worktree'li bir repoda ajan çalışırken diff rozeti, status paneli ve PR düğmesi kontrol edilmeli. Ulaşılamayan remote'lu 5+ worktree açıkken status paneli beklemeden açılmalı. GCM yüklü Windows'ta süresi dolmuş kimlik bilgisiyle arka planda pencere çıkmamalı, push'ta çıkmalı. Windows'ta source control, history ve explorer açılış süreleri ölçülüp buraya yazılmalı.

**Bitince changelog taslakları:**

- Fixed (mevcut satırla birleştir): "Source control, history and branch changes open immediately instead of waiting for a slow remote fetch, and git commands start faster on Windows."
- Improved: "Background remote refreshes never open credential prompts, run once per repository across worktrees, and no longer hold up local git status."
- Improved: "Diff totals stay responsive while agents create many new files."

## P2: explorer, workspace araması ve watcher'lar

- [ ] **22: kimsenin okumadığı `hasChildren` için her alt klasör taranıyor (refactor).**
      `workspaceEntries.ts:260-269, 329` her alt dizin için tam `readdir` yapıyor ve `EXPLORER_EXCLUDED_NAMES` (`:45`) `node_modules`'u dışlamıyor. Alanı okuyan yok: `ProjectPicker.tsx:323` yalnız kopyalıyor, `ComposerLocalDirectoryMenu.tsx:319` kendisi hesaplıyor, explorer ağacı hiç bakmıyor. Alanı her yerden sil: server (`directoryHasChildDirectories`), contracts (`packages/contracts/src/workspace/project.ts:42,51`), web (`ProjectPicker`, `ComposerLocalDirectoryMenu`). `resolveRealPathWithinRoot` hedef doğrulaması ve sıralama aynı kalır. Bu contract değişikliği olduğu için tam `bun run test`.

- [ ] **F: explorer yüklenirken boş görünüyor (düzelt).**
      `projectReactQuery.ts:223` `placeholderData: previous ?? { entries: [] }` dönüyor; TanStack v5'te placeholder varken sorgu `success` olduğu için `WorkspaceExplorerTree.tsx:61`'deki yükleniyor dalı hiç çalışmıyor. Dizin listeleme sorgusundan `placeholderData`'yı kaldır; `DockExplorerPane` `fetchQuery` kullandığı için etkilenmez. Aynı dosyada `includeFiles` sorgu anahtarında yok (`:398`); farklı `includeFiles` değerleri aynı cache girdisini paylaşıyor. Bunu da düzelt.

- [ ] **G: explorer git çağrıları arka plan şeridinde bekliyor (ölç-sonra-karar).**
      Klasör listesi başına `rev-parse` ve `check-ignore` (`workspaceEntries.ts:341-350`) `withPermit(..., "background")` ile ortak kuyrukta bekliyor (`Layers/WorkspaceEntries.ts:32`), oysa listeleme etkileşimli. #22 ve P1 #6'dan sonra ölç: status yenilemesi yoğunken klasör açmada kuyruk bekleme süresi. Anlamlıysa listeleme çağrılarını foreground'a al. Hover prefetch'i zaten 150 ms niyet gecikmeli (`ExplorerFileRow.tsx:23-41`); dokunma.

- [ ] **13: workspace index soğuk build bekletiyor ve ignore'u iki kez uyguluyor (iyileştir).**
      İlk taramadaki "15 saniyede bir yeniden kurulum" doğru değil: build istek üzerine yapılıyor, bayat endeks 60 saniyeye kadar arka planda yenilenirken sunuluyor (`workspaceIndexCache.ts:62-83`). Gerçek sorunlar:
      Birincisi, `ls-files --cached --others --exclude-standard` sonrası tüm listeye 256 KB'lık sıralı parçalarla `check-ignore --no-index` uygulanıyor; amaç tracked ama ignore'a uyan dosyaları dışlamak (commit `9cce50901`). Bunu tek bir `git ls-files --cached --ignored --exclude-standard -z` ile o küçük kümeyi alıp listeden çıkararak yap; `ls-files` ve `--deleted` paralel çalışsın. Dosya sistemi taraması fallback'i (`buildWorkspaceIndex`) `check-ignore` kullanmaya devam eder. `workspaceEntries.test.ts`'teki tabloya dizin kalıbına uyan tracked dosya vakasını (`.convex/` gibi) ekle; davranış eşdeğerliğini o kanıtlar.
      İkincisi, `CheckpointReactor.ts:431,1123,1297` ve `conversationEdit.ts:110` her checkpoint sonrası slotu siliyor, sonraki @-mention soğuk build bekliyor. `WorkspaceEntries.invalidate` slotu temizlesin ve slot varsa (yakın zamanda arama yapıldıysa) hemen yeni build başlatsın; çağıranlar modül fonksiyonu yerine bu servisi kullansın. Geçersiz kılınan build sonucunun cache'e geri yazılmaması korunmalı.
      `core.fsmonitor=false` ve `core.untrackedCache=false` **ellenmeyecek**: fsmonitor repo config'iyle keyfi komut çalıştırabilir (güven sınırı), untracked cache index'e yazar ve bayat sonuç riski taşır (commit `37d7f8031`).
      Ölç: 100 bin dosyalık bir repoda build süresi, önce ve sonra.

- [ ] **26: içerik aramasında dosya başına gereksiz realpath (iyileştir).**
      `WorkspaceContentSearch.ts:57` her dosya için `resolveRealPathWithinRoot` çağırıyor; bu her seferinde kökün de `realpath`'ini alıyor (`realPathContainment.ts:30-33`). Kökü arama başına bir kez çöz; `realPathContainment`'a çözülmüş kök alan bir varyant ekle (ikinci bir containment yolu değil). Dosya başına `realpath` ve containment kontrolü kalır: symlink sonradan değişebilir, bu bir güven sınırı. ripgrep'e geçmek **ellenmeyecek**: projede yok; yeni bağımlılık, paketleme ve Windows/WSL çözümü ister, `searchQuery.ts`'teki `u` bayrağı ve lookbehind Rust regex'te desteklenmiyor.

- [ ] **H: worktree watcher'ı her dosya değişikliğinde status zincirini tetikliyor (iyileştir + düzelt).**
      `gitRepositoryChanges.ts:187-190` tüm ağacı recursive izliyor ve yalnız `.git`'i filtreliyor; her event `GitStatusBroadcaster.ts:179-186`'da status zincirini tetikliyor. 300 ms penceresindeki yolları biriktir, tek `check-ignore --stdin` ile (index'i dikkate alarak) hepsi ignore ediliyorsa yenilemeyi atla; dosya adı `null` gelirse her zaman yenile.
      Linux'ta (düzelt): server Bun ile çalışıyor ve recursive izleme `node_modules` dahil her dizine ayrı inotify watch ekliyor; `ENOSPC` olursa hata tüm `Stream.merge`'i düşürüyor ve git metadata watcher'ı da duruyor, ardından 5 saniyelik retry her denemede ağacı yeniden tarıyor. Worktree watcher'ının hatası metadata watcher'ından ayrılsın; ayrı retry ve açık bir uyarı olsun, sessiz fallback değil. Ölç: büyük repoda inotify watch sayısı (`/proc/<pid>/fdinfo`).

- [ ] **I: dizin watcher'ları ve yerel yol araması (ölç-sonra-karar).**
      `workspaceDirectoryChanges.ts:52-56` klasör başına iki watcher kuruyor ve üst dizindeki eşleşen her event'te yeniden kuruyor. Ölç: macOS FSEvents'te alt klasördeki düzenleme `rename` mı `change` mı üretiyor; gerekirse yeniden kurulumu yalnız `rename`'de yap. `resolveRealPathForCreateWithinRoot` kapsamını koru.
      Yerel yol araması (`workspaceEntries.ts:393-477`) her sorguda diski yeniden tarıyor; web zaten debounce ve en az 2 karakter şartı uyguluyor. Ölç: home kökünde p95 süre ve `truncated` oranı. Gerekirse aynı modülde `rootPath + includeFiles + includeDotfiles` anahtarlı, 10 saniyelik tek girdili aday cache'i.

**Doğrulama:** `bun run check`, tam `bun run test` (contracts değişiyor), `bun scripts/check-windows-runtime-boundary.ts` (watcher'lar). Dev'de explorer, proje seçici, @-mention ve source control; ajan dosya değiştirdikten hemen sonra @-mention. `npm install` veya build çalışırken status yenileme sayısı. Windows ve WSL'de watcher davranışı, Linux'ta büyük repo ile watcher dayanıklılığı.

**Bitince changelog taslakları:**

- Improved: "The file explorer opens large folders faster and shows a loading state instead of an empty tree."
- Improved: "File mentions open faster after agents change files and in large repositories."
- Improved: "Installing dependencies or running builds no longer keeps source control busy, and file watching recovers on Linux when watch limits are reached."

## P3: orchestration hot path, persistence ve checkpoint'ler

- [ ] **4: attachment side effect'leri her event'te ve commit'ten önce çalışıyor (düzelt).**
      Hot fazda `phaseCursor` hep verildiği için `runProjectorsForEventCore` (`ProjectionPipeline.ts:224-281`) hiç `null` dönmüyor; `runAttachmentSideEffects` (`attachmentEffects.ts:44-47`) koşulsuz `readDirectory(attachmentsDir)` yapıyor. Bu, assistant delta'ları dahil her event'te engine write transaction'ı içinde oluyor (`OrchestrationEngine.ts:977-985, 1047`).
      Daha ciddi olanı: `thread.deleted`, `thread.reverted` ve rollback event'leri legacy attachment dosyalarını commit'ten önce `fileSystem.remove` ile siliyor. Transaction sonradan (ör. receipt çakışmasıyla, `:1015`) geri alınırsa dosyalar gitmiş ama event yazılmamış olur.
      Yaklaşım: iki küme de boşsa hemen dön. `projectHotEventInCurrentTransaction` side effect'leri döndürsün, `OrchestrationEngine` bunları `sql.withTransaction` sonrasında çalıştırsın. `managedAttachments.mark*` satırları transaction içinde kalır; fiziksel silme `ManagedAttachmentCleanup` worker'ının işi. Commit sonrası crash'te yetim dosya kalabilir: bu sızıntıdır, veri kaybı değildir. Event sırası, `deferredSettledSequences` ve transaction dışındaki bootstrap replay yolu değişmez.
      **Regression testi:** `attachmentCleanup.test.ts`'e "rolled-back revert command keeps legacy attachment files"; düzeltmeden önce kırmızı olmalı.

- [ ] **28: thread silme tüm event tablosunu tarıyor (ölç-sonra-karar, muhtemelen düzelt).**
      `profileStatsArchive.ts:751-758`'deki `OR json_extract(payload_json,'$.threadId')=?` `idx_orch_events_stream_sequence` index'ini devre dışı bırakıyor; tarama `purgeThreadWithStatsSnapshot` transaction'ında writer lock'u tutuyor ve streaming'i blokluyor (`ThreadDeletionReactor.ts:189`). Decider'larda thread event'lerinin `aggregateId` ve `payload.threadId` değerleri hep aynı; ifade `5c45ae02d` ile savunma amaçlı eklenmiş görünüyor. Gerçek DB'nin kopyasında, izole home'da ölç:
      `SELECT event_type, count(*) FROM orchestration_events WHERE aggregate_kind='thread' AND json_extract(payload_json,'$.threadId') IS NOT stream_id GROUP BY 1`
      Sonuç 0 ise `OR` dalını kaldır; migration gerekmez. Değilse o event tiplerini `event_type` index'iyle hedefle. Index gerekirse migration 2+, idempotent (`IF NOT EXISTS`), lineage kontrolüyle.

- [ ] **14: checkpoint diff'i yalnız dosya listesi için tam patch üretiyor (iyileştir).**
      `CheckpointReactor.ts:437, 715` tam `--patch --minimal` çıktısını yalnız `parseCheckpointFilesFromUnifiedDiff` için istiyor; bu yalnız path, kind, additions ve deletions üretiyor (`Diffs.ts:29-48`). UI'ın tam patch'i aldığı `CheckpointDiffQuery.ts:231,327` aynen kalır. `CheckpointStore`'a tek spawn'lık bir özet metodu ekle (`git diff --raw --numstat -z --no-ext-diff --no-textconv`, kind `--raw` status'tan, rename ayarı mevcut diff ile aynı); iki çağıranı taşı, `parseCheckpointFilesFromUnifiedDiff`'in başka kullanıcısı kalmazsa sil. Davranış farkı: binary `-` gelir ve 0 sayılır; bugün `maxOutputBytes` aşılınca liste boş dönüyor, artık büyük turn'lerde de dosya listesi görünecek.
      Capture'ın 6-7 git spawn'ını azaltmak **ellenmeyecek**: `--really-refresh` ve `utimes` temp indeksin racy-git doğruluğu için gerekli. Ölç: büyük repoda capture süresi; anlamlıysa turn başı capture'a `priority: "background"`.
      **Test:** gerçek git repo ile tablo testi, "summarizes added, deleted, renamed and binary files".

- [ ] **J: küçük kontroller için tam shell snapshot (iyileştir, düşük öncelik).**
      `claimNativeChildSlot` (`ProviderRuntimeIngestion.ts:786`) ve stop sırasında `taskControl.ts:69` tüm thread'leri içeren `getShellSnapshot`'ı küçük bir filtre için çağırıyor. `ProjectionSnapshotQuery`'ye `idx_projection_threads_parent_thread_id`'yi kullanan `listChildThreadShells(parentThreadId)` ekle; iki çağıranı taşı, deleted/archived görünürlük filtrelerini koru. Ölç: binlerce thread'le shell snapshot süresi. Web'deki `routeRestoreRefreshCoordinator.ts:75` `getSnapshot` çağrısı yalnız tüm shell denemeleri boş dönünce çalışan nadir bir fallback; **ellenmeyecek**.

- [ ] **15: streaming'de token başına transaction (ölç-sonra-karar).**
      Provider delta'ları `providerRuntimeEventPump.ts:265-285`'te 100 ms / 256 delta penceresiyle tek transaction'da journal'a yazılıyor; ama journal'da hâlâ delta başına bir satır var ve streaming modunda her delta için ayrı `orchestrationEngine.dispatch` yapılıyor (`ProviderRuntimeIngestion.ts:2137-2149`). Bu, token başına bir transaction ile birlikte tahminen 3-4 insert ve 3 update demek: `orchestration_events`, `command_receipts`, `messageTextChunks.append`, projection state upsert'leri ve deferred cursor güncellemesi. Ölç: token başına commit süresi (p50/p99), token başına satır sayısı ve DB büyümesi, uzun bir streaming turn'ünde event loop gecikmesi.
      Coalescing ayrı bir tasarım kararıdır: bugün exactly-once garantisini event başına `commandId` ve receipt sağlıyor. Birleştirilmiş komut commit olup cursor flush'tan önce crash olursa replay grupları farklı keser ve metin çoğalır. Yapılacaksa cursor ilerletmesi engine transaction'ına atomik girmeli ya da gruplama journal'dan deterministik türetilmeli; `segmentStartedAt`/`segmentSequence` yalnız grubun ilk delta'sında olmalı ve auto-follow gerçek streaming'e bağlı kalmalı. Bu madde ölçümle kapanır veya ayrı bir plana dönüşür.

**Doğrulama:** her adımda `bun run check` ve etkilenen testler (`attachmentCleanup.test.ts`, `streamingTransactions.test.ts`, `engineTransactions.test.ts`, `ThreadDeletionReactor.test.ts`, `ProfileStatsQuery.test.ts`, `CheckpointStore.test.ts`, `CheckpointStore.restore.test.ts`, `ProviderRuntimeIngestion.test.ts`, `snapshotLookup.test.ts`). #4 ve #28 için tam `bun run test`. Migration olursa lineage kontrolü. Ölçümler kullanıcının veritabanının kopyasında.

**Bitince changelog taslakları:**

- Fixed: "Reverting or deleting a chat can no longer remove attached images when the change fails to save."
- Improved: "Turn change summaries appear for very large turns too."
- Improved (yalnız ölçüm görünür bir takılma gösterirse): "Deleting a chat no longer stalls running agents."

## P4: web istemcisinde yenileme ve render maliyeti

İlk taramadaki bazı iddialar düzeltildi: TanStack 5.90 `focusManager` yalnız `visibilitychange` dinler, yani in-app browser'a tıklamak bu yolu tetiklemez (o iş `useProviderStatusRefresh.ts:144` ve `useRefreshOnWindowReturn.ts`'teki `window "focus"` dinleyicilerinde). Model listesi server'da zaten cache'li. `tool.completed` geçersizleştirmesi tüm projeleri değil ilgili cwd'yi kapsıyor.

- [x] **K: `DesktopProjectBootstrap` her streaming flush'ında render oluyor (düzelt).**
      `-rootDesktopBootstrap.tsx:11,65` mesajlar dahil tüm thread dizisine abone. Seçici shell verisinden ilkel bir değer döndürsün (`hasThreadWithoutProject` veya yalnız projectId kümesi); `threads` bağımlılığı kalksın. Profiler'da streaming sırasında bileşen commit'e girmemeli; masaüstünde proje kurtarma akışını elle dene.

- [x] **21: work log her flush'ta yeniden türetiliyor (düzelt).**
      `useChatWorkLog.ts:38-49`'da `messages` kimliği her flush'ta değiştiği için `workLogVisibleTurnIds` Set'i ve `deriveWorkLogEntries` yeniden çalışıyor. Aktivite başına `WeakMap` cache'i (`workLog.entries.ts:75,363`) olduğu için asıl maliyet değişen kimliklerin zinciri: seçici, enrich ve timeline yeniden kuruluyor. Set'i sıralı turnId'lerden üretilen bir string anahtar üzerinden memo'la; mevcut `useMemo` kalabilir çünkü değer store seçicisine gidiyor. Timeline satırları için (`useTimelineStateController.tsx:231`) önce profiler'la streaming commit süresini ölç. Auto-follow ve virtualization kararına dokunma.
      **Durum:** Set memo'su yapıldı; timeline satırları için profiler ölçümü yapılmadı, açık.

- [x] **27: sohbetteki kod bloklarında boyut sınırı yok ve highlight main thread'de (düzelt).**
      `ChatMarkdown.tsx:589-613` render sırasında senkron Shiki çalıştırıyor ve sohbette hiç boyut sınırı yok; `MAX_SYNTAX_HIGHLIGHT_INPUT_CHARS` yalnız `WorkspaceFileContents.tsx:165`'te uygulanıyor. Sınırı aşan kod için `ChatMarkdown.tsx:745-756`'daki mevcut `highlightedFallback`'i döndür. Diff worker havuzunu yeniden kullanmak (`WorkerPoolManager.highlightFileAST`) instance adaptörü, HAST'tan HTML'e dönüşüm ve find entegrasyonu ister; yalnız eşik altındaki bloklarda 50 ms'yi aşan long task görülürse yap. `ChatMarkdown.test.tsx` ve Dev'de büyük bir JSON yanıtıyla doğrula.

- [ ] **1: görünürlük dönüşünde git sorguları iki kez yenileniyor (düzelt).**
      `useGitStatusPush.ts:112-117` her abone cwd için `["repository","files"]` geçersizleştirmesi yapıyor; aynı anda sorguların kendi `refetchOnWindowFocus: true` ayarı var (`gitQueryOptions.ts:426,469,534,568,594`, `gitReactQuery.ts:329`). Server watcher'ı zaten push ediyor ve yeniden bağlanınca `snapshot` tam yenileme planlıyor (`useGitStatusPush.ts:95`). Hook'taki `focusManager.subscribe` bloğunu sil; watcher'ın kaçırdığı durumlar için tek güvenlik ağı sorgu başına `refetchOnWindowFocus` olsun. Hiçbir sorgunun kullanmadığı ölü `["git","stash-info",cwd]` anahtarını da sil. Glade dışında yapılan commit ve checkout'lar panele yansımaya devam etmeli; pencereyi küçültüp açınca her git RPC'si bir kez görünmeli.

- [ ] **L: event'e bağlı geçersizleştirme watcher'ın işini tekrarlıyor (düzelt).**
      `tool.completed`, ilgili cwd için `refreshGitQueriesForCwd` ile status, branches, history, PR (gh) ve diff sorgularını yeniden çekiyor (`-streamBatching.ts:34-67`, `gitQueryOptions.ts:174-260`); watcher'ı olan cwd'de bu tekrar. `turn-diff-completed` ise `providerQueryKeys.all` ve `projectQueryKeys.all`'ı tüm projeler için geçersiz kılıyor (`-streamBatching.ts:29-34`). `tool.completed` git yenilemesini yalnız aktif bir `gitQueryKeys.status(cwd)` sorgusu olmayan cwd'lerde yap (`useGitStatusPush` ile aynı yüklem, yeni state sahibi yok). `turn-diff-completed`'i thread'e kapsamla: `["providers","checkpointDiff",threadId]` ve mevcut `invalidateProjectFileQueriesForCwds`. Tur sonundaki diff ve dosya ağacı tazeliği korunmalı.
      **Test:** `-rootEventInvalidation` saf mantığı için test yok; "scoped turn diff invalidates only that thread's keys" tablo testi.

- [ ] **M: sidebar PR sorgusu kaydırmayla yeniden tetikleniyor (düzelt).**
      `useThreadPullRequests.ts:106` sorgu anahtarında görünen worktree'ler var; kaydırma her seferinde `gh pr list --limit 1000` ve worktree özetlerini yeniden çağırıyor (`gitSidebarSummary.ts:20`). `targetsKey` değişince tüm `summaryOnly` abonelikleri yeniden kuruluyor (`:116-137`) ve her yeni abonelik server'da `git.summary` başlatıyor. Anahtar `["git","sidebar",cwd]` olsun; yeni worktree'nin özeti abonelikle gelen ilk `summaryUpdated`'dan upsert edilsin. Abonelikler cwd bazında fark alınarak yönetilsin (`useGitStatusPush.reconcile` deseni); `staleTime` birkaç dakikaya çıksın. `lastKnownPr` geri dönüşü ve canlı dal/özet güncellemesi korunmalı.

- [x] **2: model listesi her görünürlük dönüşünde zorla yenileniyor (iyileştir).**
      `providerDiscoveryReactQuery.ts:427` `refetchOnWindowFocus: "always"`; `4aff2b1a5` ile gerekçesiz eklenmiş. Server cache'i (`providerModelDiscoveryCache.ts`) 30 dakika taze, 24 saat stale-while-revalidate ve kalıcı. Varsayılan `true`'ya çek; stale veride staleTime zaten 0. Hesap değişikliği context kimliği üzerinden sorgu anahtarını değiştiriyor. Ölç: görünürlük dönüşü başına `provider.listModels` RPC sayısı (beklenen 2'den 0'a). Başka terminalde login/logout sonrası katalog yine güncellenmeli.

- [ ] **20: turn sırasında tam thread snapshot'ı (ölç-sonra-karar).**
      Sequence tabanlı replay zaten var (`-streamEvents.ts:409-490`); tam snapshot yalnız replay senkron doğrulanmadıysa çekiliyor (`threadDetailCatchupPolicy.ts:7`). Ancak streaming yoğunken iki tik arasında yeni event geldiği için `emptyReplayAtEventSerial` hiç `appliedEventSerial`'a eşit olmuyor; tam snapshot 4,5 saniyeden 72 saniyeye kadar artan aralıklarla çekiliyor. Ölç: uzun bir thread'de tek turn boyunca `getThreadDetailSnapshot` çağrı sayısı, yük boyutu, decode ve `syncServerThreadDetailHotPath` süresi. Maliyet yüksekse doğrulamayı "son boş replay'den sonra uygulanan event'ler cursor'ı kesintisiz ilerletti" koşuluna bağla; tam projeksiyon yalnız onarım durumlarında (terminal fence, `hasPendingTurnDispatch`, eksik bekleyen etkileşim, taslak) çekilsin. Kayıp event onarımı ve reconnect toparlanması korunmalı. Davranış değişirse policy seviyesinde tek test: "uninterrupted live events skip full reconcile, gaps still trigger it". Server tarafında kesintisizlik garantisi gerekirse iş P3'e geçer.

- [ ] **N: düşük öncelikli istemci maliyetleri (ölç-sonra-karar).**
      `useVisibleSidebarThreadIds.ts:50-61` tüm `document.body`'yi izleyen bir `MutationObserver` ile her eklenen node'da `matches`/`querySelector` çalıştırıyor ve her render'da tüm sidebar id'lerini `JSON.stringify` ediyor; `useDesktopMenuShortcuts.ts:97-104` ikinci bir global observer. Streaming sırasında profiler'da paylarını ölç; anlamlıysa observer'ı sidebar container'ına daralt. Bu madde ikinci doğrulamadan geçmedi, önce kodu yeniden doğrula.
      `QueryClient` varsayılanları (`router.ts:11`) **ellenmeyecek**: global değişiklik 69 sorgunun tazeliğini sessizce değiştirir ve #1'den sonra history için kalan güvenlik ağı tam bu varsayılan. Sıcak noktalar sorgu başına düzeltilsin; ardından görünürlük dönüşü başına toplam RPC sayısı ölçülsün, 10'un üstündeyse yeniden değerlendir.

**Doğrulama:** `bun run check`, etkilenen web testleri (`ChatMarkdown.test.tsx`, `ChatMarkdown.compiler.test.ts`, `threadDetailResumeCursors.test.ts`, `sidebarStateStore.test.ts`). Dev'de: Glade dışında yapılan git değişiklikleri yansımalı, bağlantı kopup geri gelince her şey toparlanmalı, streaming sırasında auto-follow bozulmamalı, sidebar kaydırırken `sidebarSummary` RPC sayısı artmamalı. Görünürlük dönüşü başına RPC sayısı ve streaming sırasındaki commit süresi önce ve sonra kaydedilmeli.

**Bitince changelog taslakları:**

- Fixed: "Very large code blocks in chat no longer freeze the window."
- Improved: "Returning to Glade and scrolling the sidebar trigger far fewer git and GitHub refreshes, and long conversations stay smoother while agents stream."

## P5: provider keşfi ve process probe'ları

- [ ] **19: özel Codex provider'ında senkron login-shell probe'u (düzelt).**
      `codexProcessEnv.ts:33-46` yalnız `config.toml`'da özel bir provider `env_key` tanımlıysa ve değişken env'de yoksa çalışıyor; o durumda `execFileSync -ilc` event loop'u 5 saniyeye kadar bloklıyor ve shell'de de anahtar yoksa her çağrıda tekrarlıyor. Aynı kod PATH ve `SSH_AUTH_SOCK`'u da login shell'den yeniden okuyor; bu, `docs/windows-runtime.md`'deki "builder'lar host PATH'i yeniden keşfetmemeli" kuralını ihlal ediyor. `config.toml` her çağrıda `readFileSync` ile okunuyor (`codexConfig.ts:70-77`; altı çağıran var). PATH ve `SSH_AUTH_SOCK` override'ını kaldır. `createCachedLoginShellEnvironmentReader` kullanılamaz: diske yazdığı cache API anahtarını diske yazar. Bunun yerine süreç ömrü boyunca bellekte, `(shell, envKey)` anahtarlı bir memo kur (boş sonuçlar dahil). `config.toml` okumasını `(mtimeMs, size)` ile memo'la. `codex/tests/processEnvironment.test.ts` sözleşme değişikliğine göre güncellenir. macOS'ta `.zshrc`'de export edilmiş özel provider anahtarıyla elle doğrula.

- [ ] **25: local server monitor timeout'suz ve paylaşımsız (düzelt).**
      `localServerMonitor.ts:943-955` her çağrıda `lsof`, en fazla 4 tur `ps`, `lsof -d cwd` ve sayfa başlıkları çalıştırıyor; süreçler `node:child_process` `execFile` ile timeout'suz başlatılıyor (`:1`, `:121-133`). Takılan bir `lsof` (ör. NFS mount) süreci süresiz bırakır ve process modülü kuralını ihlal eder. Web her client için 10 saniyede bir poll ediyor (yalnız panel açıkken). Shared `execProcessFile` ile timeout ve çıktı sınırı kullan; `listLocalServers` sonucuna birkaç saniyelik server cache'i ve inflight dedupe ekle; `stopLocalServer` cache'i geçersiz kılsın, pid/port revalidasyonu korunsun. macOS ve Linux'ta iki pencere açıkken tek tarama yapıldığını ve stop sonrası listenin tazelendiğini doğrula.

- [ ] **12: Claude skill/agent keşfi her çağrıda CLI açıyor ve özel binary'yi yok sayıyor (düzelt + iyileştir).**
      Aktif oturum yoksa `listAgents` (`discovery.ts:323-345`) ve `listSkills` (`:394-412`) her çağrıda geçici bir Claude CLI açıyor; `listSkills` ayrıca bridge temp dizini ve junction'lar oluşturuyor. **Hata:** `listSkills` binary'yi `"claude"` olarak sabit kodluyor (`:399`) ve `ProviderListSkillsInput`'ta `binaryPath` yok; ayarlarda özel binary yolu varsa yanlış CLI'a soruluyor. Binary'yi `modelDiscoveryContext` ile çöz. Ardından `ProviderDiscoveryService` içinde `makeProviderModelDiscoveryCache` desenine benzer küçük bir cache kur: native isim kümesi ve agent listesi için, inflight dedupe ve hata TTL'i ile; anahtar `modelDiscoveryContext` identity digest'i (executable mtime, settings.json, hesap kimliği). Böylece CLI güncellemesi, kaldırılması ve auth değişikliği anahtarı kendiliğinden değiştirir. Aktif oturumun `supportedCommands` sonucu, `forceReload`, `teardownFailedDiscoveryProcesses` sırası ve bridge cleanup korunur.
      **Regression testi:** "listSkills uses the configured Claude binary"; önce kırmızı olmalı.

- [ ] **18: her Claude oturumu ve dallanmada `claude --version` (refactor) ve skill rescan'i (ölç-sonra-karar).**
      `resolveClaudeStartPreflight` (`ClaudeSessionAccess.ts:97-127`) her start, fork ve branch'te (`sessionBranching.ts:130,228`) `readInstalledClaudeCliVersion` çalıştırıyor; Codex'te cache'li bir gate var (`codexCliVersionGate.ts:187-239`: 10 dakika TTL, `executableIdentity` ile bayatlık, hatalar cache'lenmiyor). Gate'in cache kısmını (inflight, TTL, fingerprint) saf bir modüle taşı (`provider/core/cliVersionGate.ts`); Codex gate ve Claude preflight bunu kullansın. Anahtar çözülmüş binary yolu artı PATH; desteklenmeyen sürüm ve hatalar cache'lenmez. Windows `.cmd` shim'i sürüm güncellemesinde değişmeyebilir; bunu 10 dakikalık TTL sınırlar, ayrıca `providerMaintenance` üzerinden yapılan güncellemeler gate'i açıkça temizlesin. Net satır azalmalı.
      Skill rescan: `claudeSkillBridge.ts:55` her oturum başında `forceReload: true` ile tarıyor (`sessionStartup.ts:217`). Skill kurulumunda cache'i geçersiz kılan bir yol olmadığı için tazeliği bu tarama sağlıyor. Büyük bir plugin ağacında süresini ölç; milisaniyeler mertebesindeyse ellenmesin.

- [ ] **5: kullanım göstergesi her poll'da binlerce transcript'i baştan okuyor (iyileştir).**
      `loadClaudeUsageSnapshot` (`providerUsageSnapshot.ts:611-620`) en yeni 2000 `.jsonl`'u her seferinde baştan sona stream ediyor (Codex yalnız kuyruğu okuyor). Web iki sorguyla 30 ve 60 saniyede poll ediyor (`serverReactQuery.ts:260-261, 339-340`); TTL de 30 saniye olduğundan cache neredeyse her poll'da dolmuş bulunuyor. Sorgular `SidebarView.tsx:576` içinde hep mount'lu. Aynı modülde, dışarı açılmayan tek bir `Map` ile dosya bazlı cache tut (`path → {mtimeMs, size, samples}`); yalnız değişen dosyaları yeniden parse et, mtime'ı 30 gün penceresinin dışındakileri hiç parse etme, listeden düşen path'leri buda. Web'de iki sorgunun aralığını 60 saniyeye eşitle, snapshot sorgusunun `staleTime`'ı TTL'den büyük olsun. 24 saat, 7 gün ve 30 gün toplamları, oturum dedupe'u, `CLAUDE_CONFIG_DIR` anahtarı ve satır başına 1 MB sınırı korunur. Gerçek bir `~/.claude/projects` üzerinde önce/sonra süre ve CPU ölç.
      **Test (modülde hiç yok):** "unchanged transcripts are not reparsed and growing transcripts count new samples" (`providerUsageSnapshot.test.ts`).

- [ ] **O: editor keşfi senkron (iyileştir, düşük öncelik).**
      `resolveAvailableEditors()` (`wsRpc.ts:637`) her `subscribeServerConfig`'te, yani bağlanma ve yeniden bağlanmada senkron çalışıyor. Windows'ta Store paketli editor için komut bulunamazsa `execFileSync powershell Get-AppxPackage` (`editorAppDiscovery.ts:170-227`, 1,5 saniye timeout) çalışıyor; "kurulu değil" sonucunun 5 dakika cache'lenmesi doğru. Sonucu `env.PATH` anahtarlı kısa TTL'li bir memo'ya al; Appx sorgusunu `execProcessFile` ile async yap. Windows'ta VS Code Store sürümüyle doğrula.

- [ ] **23: Windows terminal aktivite poll'u ve teardown snapshot'ları (ölç-sonra-karar + iyileştir).**
      Terminal aktivitesi meşgulken 1 saniyede, boşta 8 saniyede bir `Get-CimInstance Win32_Process` ile tüm süreçleri listeliyor (`Manager.ts:72-74, 2004-2016`); worker kalıcı ve sıcak. Her teardown ise yeni bir PowerShell observer açıp kapatıyor (`supervisedProcessTeardown.ts:139-143, 320`). `CommandLine` atılamaz: `subprocessActivity.ts:49-76` CLI türünü komut satırından çıkarıyor. Önce gerçek Windows'ta `Get-CimInstance` süresini ve CPU'sunu (projeksiyonlu ve projeksiyonsuz) ve teardown başına soğuk PowerShell süresini ölç. Ardından CIM sorgusuna `-Property ProcessId,ParentProcessId,CreationDate,CommandLine,Name` projeksiyonu ekle ve süreç başına tek paylaşılan worker sahibi kur, tüketici başına kendi backoff'u olsun.
      **Kritik koşul:** teardown capture'ı istek anından sonra başlamış taze bir snapshot almalı. Mevcut `inFlight` yeniden kullanımı daha önce başlamış bir snapshot döndürebilir; o zaman yeni doğmuş bir descendant kaçar ve süreç sızar. Aynı kural `onlyIfIdle` için de geçerli. Değişikliği `windowsProcessSnapshot.ts` ve observer enjeksiyonuyla sınırla; `Manager.ts`'e mantık ekleme (P6 ile sıralı).

- [ ] **24: POSIX teardown'da senkron `ps` (ölç-sonra-karar).**
      İlk taramadaki "250 ms'de bir tam `ps`" abartılı: tam `ps -eo` yalnız capture sırasında ve en fazla `PROCESS_TREE_CAPTURE_ATTEMPTS` deneme kadar çalışıyor (`processTreeController.ts:70-82`); grace süresince yalnız hedefli `ps -p <pids>` var (`:84-104`). Terminal kapanışındaki senkron capture (`Manager.ts:1686`) sync API yüzünden bilinçli. Yüklü bir makinede (2000+ süreç) `ps -eo` süresini macOS ve Linux'ta ölç; 50 ms'yi aşarsa yalnız provider teardown yolunu async `execProcessFile`'a geçir, terminal yolu senkron kalsın.

**Doğrulama:** `bun run check`, etkilenen server testleri (`codexCliVersionGate`, `processEnvironment`, `providerModelDiscoveryCache`, `configuration`, `processLifecycle`, `forkThread`, `supervisedProcessTeardown`, `processTreeController`, `Manager`), process lifecycle değiştiği için tam `bun run test`, `bun scripts/check-windows-runtime-boundary.ts`. Gerçek makine gerektirenler: Windows (#23, O), Linux (#24, #25), macOS (#19).

**Bitince changelog taslakları:**

- Fixed: "Skill lists use your configured Claude CLI path."
- Fixed: "Custom Codex providers no longer make the app stall, and the local server list no longer hangs when system tools stop responding."
- Improved: "Claude sessions, forks and skill and agent lists start faster."
- Improved: "Usage indicators use far less CPU with large Claude histories."
- Improved (yalnız teardown paylaşımı yapılırsa): "Terminals and sessions close faster on Windows."

## P6: masaüstü açılışı ve terminal kalıcılığı

Kapsam dışı #10'a bağımlılık: prod'da pencere `startBackend`'den sonra açılıyor (`createDesktopRuntime.ts:170,199`). #8 ve #9'un pencerenin görünme süresine etkisi bu sırayla sınırlı. Ölçüm metriği: desktop logundaki `app ready` ile `bootstrap main window created` arasındaki fark, Windows ve macOS'ta.

- [ ] **11: terminal geçmişi sürekli baştan yazılıyor ve kapanışta son çıktı kayboluyor (düzelt + iyileştir).**
      Çıktı akarken 250 ms'lik throttle ile (`Manager.ts:71, 1868-1880`) her yazımda tam `toString` (`terminalHistory.ts:112-129`), ardından temp dosya, rename ve `repairPrivateFile` çalışıyor (`Manager.ts:1826-1834`). **Hata:** `disposeInternal` bekleyen yazımları flush etmeden `pendingPersistHistory` ve `persistQueues`'u temizliyor (`:1214-1223`); normal kapanışta son ≤250 ms'lik çıktı kayboluyor ve debounce uzarsa kayıp büyür. Önce `disposeForShutdown` temizlemeden önce tüm oturumlar için `flushPersistQueue`'yu beklesin (desktop kapanış süresi içinde). Sonra `schedulePersist` idle-debounce (ör. 1 sn) ve max-wait (ör. 5 sn) olsun; close, evict ve shutdown flush etsin. `PRIVATE_FILE_MODE`, `repairPrivateFile`, atomik rename ve legacy okuyucu korunur; SIGKILL'de en fazla max-wait kadar kayıp kabul edilir. Append-only log ve compaction **ellenmeyecek**: replay-safe kırpma, kontrol dizisi sanitizasyonu ve disk formatı göçü ister, kazancı ölçülmeden haklı çıkmaz. Dosyayı büyütmemek için persist mantığını mümkünse terminal history modülüne taşı (P5 #23 ile sıralı).
      **Regression testi:** `Manager.test.ts`'e "terminal output written just before shutdown is restored on reopen"; düzeltmeden önce kırmızı olmalı.

- [ ] **Q: Windows görev çubuğu yardımcısı yarım derlenirse kalıcı bozuk kalıyor (düzelt + iyileştir).**
      `windowsShellAppUserModel.ts:280-291` `csc.exe`'yi `whenReady` içinde (`createDesktopRuntime.ts:217-219`) timeout'suz `spawnSync` ile çalıştırıyor. **Hata:** csc doğrudan `/out:exePath`'e yazıyor ve `existsSync` (`:275`) yeterli sayılıyor; derleme yarıda kesilirse bozuk exe kalıcı olarak kullanılır. Temp çıktıya derleyip rename et ve timeout ekle. Derleme async ve memoize olsun; `whenReady`'deki ön ısıtmayı kaldır, `queueWindowsShellAppUserModelStamp` (`appIdentity.ts:266`) derlemeyi beklesin. Windows'ta temiz `taskbar-icons` ile ilk açılışı ve sabitlenmiş ikonu doğrula.

- [ ] **8: shell ortam probe'u ilk pencereyi bekletiyor (iyileştir; POSIX'te ölç-sonra-karar).**
      `desktopEnvironment.ts:26` modül yüklenirken senkron çalışıyor. Windows'ta `shell.ts:274-282` PowerShell'i cache'siz `execFileSync` ile çağırıyor (5 sn timeout). macOS ve Linux'ta login shell cache ıskalanınca çalışıyor (`syncShellEnvironment.ts:81-95`; cache 7 gün, SSH soketi kaybolursa yenileniyor). Linux'ta probe senkron **kalmalı**: `userDataPath` (`desktopEnvironment.ts:103`) probe'dan gelebilecek `XDG_CONFIG_HOME`'u okuyor (`desktopUserDataProfile.ts:47`). Win32 ve darwin'de `main/lifecycle/syncShellEnvironment` ortamın tek sahibi olsun, probe'u `execProcessFile` ile async başlatsın ve `ready(): Promise<ShellEnvironmentSyncResult>` açsın; backend env'i ve CUA spawn'ı (`cuaDriverGeneration.ts:140`) bunu beklesin. Windows için registry anahtarlı bir cache şimdi eklenmez; önce PowerShell süresi desktop loguna yazılsın, sonra karar verilsin. İlk provider ve terminal spawn'ında PATH doğru olmalı, `GLADE_PATH_HYDRATED` iki yönde doğru yazılmalı, probe başarısızsa `pathHydrated:false` kalmalı. Gerçek launcher'la Finder/Dock'tan açıp terminalde `echo $PATH` ve provider sağlık kontrolüyle doğrula.

- [ ] **R: zoom faktörü için senkron IPC (iyileştir).**
      `preload.ts:195` `sendSync` kullanıyor ve `useBrowserRuntime.tsx:518` bunu her bounds ölçümünde, burst sırasında her karede çağırıyor (`:545-581`). `zoom-changed` yalnız tekerlek ve pinch'te tetikleniyor, `setZoomFactor` çağrılarında değil (`mainWindow.ts:663,672,716,727`). Main süreç her `setZoomFactor` sonrası `sendDesktopZoomFactor` göndersin; `apps/web/src/lib/desktopZoom.ts` değeri bir kez okuyup abonelikle güncel tutsun. Preload API'si değişmez. Menü, kısayol ve pinch ile zoom yapıp browser paneli hizasını kontrol et.

- [ ] **9: güncelleme sonrası ilk açılışta senkron web bundle kopyası (ölç-sonra-karar).**
      `staticSnapshot.ts:34-45` yaklaşık 2400 dosyayı (38 MB) asar'dan senkron kopyalıyor; `registerDesktopProtocol` üzerinden `whenReady` içinde (`desktopResources.ts:212, 277`). Snapshot gerekli: app.asar çalışan uygulamanın altında değiştirilirse süreç içindeki eski asar başlığı yanlış ofsetlerden okur (`apps/server/src/server/config.ts:240-243`); backend de aynı dizini `GLADE_STATIC_DIR` olarak alıyor. Doğrudan asar'dan servis etmek **ellenmeyecek**. Mevcut `static snapshot created ... in Xms` log satırıyla Windows ve macOS'ta ölç. ~300 ms'yi aşarsa `ensureStaticSnapshot`'ı sınırlı eşzamanlılıkla async yap: protokol hemen kaydedilsin, handler kök promise'ini beklesin, backend spawn da aynı promise'i beklesin. Staging + rename, sentinel kontrolü, kopya sonrası `isBundleStable` ve `BundleChangedDuringStartupError` → `restartAfterStartupBundleSwap` yolu korunsun.
      **Test (async'e geçilirse):** snapshot için hiç test yok; `staticSnapshot.test.ts`'e "a partial staging copy is never served and the next launch completes it". `bun run build:desktop` ve paketli uygulamada güncelleme simülasyonu.

- [ ] **S: backend çıktısı chunk başına senkron dosya açıp kapatıyor (ölç-sonra-karar).**
      Paketli uygulamada `backendSupervisor.ts:373-384` → `RotatingFileSink.write` her parçada `appendFileSync` ile açıp kapatıyor (`packages/shared/src/platform/logging.ts:49-53`), Electron main süreçte. Yoğun bir oturumda backend log bayt/sn, chunk/sn ve main süreçteki süreyi ölç. Gerekirse sink açık bir fd tutup `writeSync` kullansın; bu crash'te de dayanıklıdır ve `EventNdjsonLogger`'a da yarar.

- [ ] **T: pencere gizliyken terminal çıktısının yavaşlaması (ölç-sonra-karar).**
      Zincir gerçek: `backgroundThrottling: true` (`mainWindow.ts:237`) enerji benchmark'ı için bilinçli; gizliyken rAF durur, timer'lar ~1 sn'ye hizalanır; ack xterm parse ettikten sonra gidiyor (`terminalRuntimeOutput.ts:64-65`); server 100 KB'ta duraklatıyor (`Manager.ts:1471`) ve watchdog yalnız 10 sn hiç ack gelmezse devreye giriyor. Beklenen etki tam tıkanma değil, gizli pencerede ~100 KB/sn mertebesinde bir throughput tavanı. Ölç: pencere küçültülmüş ve görünürken `seq 1e7` süresi, server logunda `terminal output force-resumed by ack watchdog` sayısı. Gerçekse yalnız `document.hidden` iken xterm'e yazılan baytları alınır alınmaz ack et; throttling'i kapatma.

- [ ] **U: terminal addon'ları (ölç-sonra-karar).**
      `LigaturesAddon` her terminalde yükleniyor (`terminalRuntime.ts:669`; `queryLocalFonts` ve character joiner). Yoğun çıktıda addon açık ve kapalı kare süresini karşılaştır. Gizlenince WebGL'in dispose edilmesi (`:880`) **ellenmeyecek**: gizli pane sayısı kadar WebGL context ve GPU belleği tutmamak için bilinçli; Chromium context sınırını webview'lar da kullanıyor.

**Doğrulama:** `bun run check`, tam `bun run test` (lifecycle), `bun run build:desktop`, `bun run --cwd apps/desktop smoke-test`, `bun scripts/check-windows-runtime-boundary.ts`. Dev'de gerçek launcher ve izole home; uzun build çıktısı → çıkış → yeniden açınca geçmiş geri gelmeli. Windows davranışı (Q, #8, #9) ayrı platform kontrolü gerektirir. Time-to-first-window önce ve sonra buraya yazılmalı.

**Bitince changelog taslakları:**

- Fixed: "The last lines of terminal output are kept when you quit, and busy terminals write far less to disk."
- Fixed: "The Windows taskbar icon recovers if its first-launch setup is interrupted."
- Improved: "Glade starts faster, especially on Windows."
- Improved (yalnız ölçümden sonra async'e geçilirse): "The first launch after an update opens faster."
