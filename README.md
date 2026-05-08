# CineSoft

[Latest Release](https://github.com/Margthus/Cinesoft/releases/latest)

---

## English

### Overview
CineSoft is a desktop media hub that combines movie/TV/anime discovery, torrent source search, download management, and library tracking in one interface.

### Features
- Discover movies, TV shows, and anime in one place
- TMDB-powered metadata, posters, and detail pages
- Advanced source search with Prowlarr integration
- Alternative source search with Torrentio support
- Sort sources by seeders, size, and name
- Enable/disable torrent sites from settings
- Choose between embedded torrent engine or qBittorrent
- Select files before starting downloads
- Download queue and status tracking
- Personal library view for downloaded media
- Poster status tags: Watched / Watch Later / Dropped
- Multi-language UI (Turkish / English)

### Screenshots

#### Home & Movies
<p align="center">
  <img src="screenshots/home.png" width="49%" />
  <img src="screenshots/movies.png" width="49%" />
</p>

#### Detail Page
<p align="center">
  <img src="screenshots/detail-overview.png" width="49%" />
  <img src="screenshots/detail-media.png" width="49%" />
</p>

#### Settings
<p align="center">
  <img src="screenshots/settings-general.png" width="49%" />
  <img src="screenshots/settings-prowlarr.png" width="49%" />
</p>

### Requirements
- [Node.js](https://nodejs.org/)
- [Git](https://git-scm.com/)
- Windows
- Optional: Prowlarr files for Prowlarr-based source search

### Installation
```powershell
git clone https://github.com/Margthus/Cinesoft
cd Cinesoft
npm install
```

### Prowlarr (Optional)
Download Prowlarr from:

https://github.com/Prowlarr/Prowlarr/releases

Extract it and place files under:

```text
resources/prowlarr/
```

This folder is intentionally excluded from the repository.

### Run
```powershell
npm start
```

### Roadmap
- Partial streaming infrastructure
- Manga viewing and reading
- Comics viewing and reading

---

## Türkçe

### Genel Bakış
CineSoft; film, dizi ve anime keşfi, torrent kaynak arama, indirme yönetimi ve kütüphane takibini tek arayüzde birleştiren masaüstü medya uygulamasıdır.

### Özellikler
- Film, dizi ve anime içeriklerini tek yerde keşfetme
- TMDB tabanlı metadata, afiş ve detay sayfaları
- Prowlarr entegrasyonu ile gelişmiş kaynak arama
- Torrentio desteği ile alternatif kaynak arama
- Kaynakları seeder, boyut ve isme göre sıralama
- Ayarlardan torrent sitelerini açma/kapatma
- Dahili torrent motoru veya qBittorrent seçimi
- İndirme başlamadan önce dosya seçebilme
- İndirme listesi ve durum takibi
- İndirilen içerikler için kişisel kütüphane görünümü
- Poster durum etiketleri: İzledim / Sonra İzleyeceğim / Bıraktım
- Çok dilli arayüz (Türkçe / İngilizce)

### Ekran Görüntüleri

#### Ana Sayfa & Filmler
<p align="center">
  <img src="screenshots/home.png" width="49%" />
  <img src="screenshots/movies.png" width="49%" />
</p>

#### Detay Sayfası
<p align="center">
  <img src="screenshots/detail-overview.png" width="49%" />
  <img src="screenshots/detail-media.png" width="49%" />
</p>

#### Ayarlar
<p align="center">
  <img src="screenshots/settings-general.png" width="49%" />
  <img src="screenshots/settings-prowlarr.png" width="49%" />
</p>

### Gereksinimler
- [Node.js](https://nodejs.org/)
- [Git](https://git-scm.com/)
- Windows
- İsteğe bağlı: Prowlarr tabanlı kaynak arama için Prowlarr dosyaları

### Kurulum
```powershell
git clone https://github.com/Margthus/Cinesoft
cd Cinesoft
npm install
```

### Prowlarr (İsteğe Bağlı)
Prowlarr indirme sayfası:

https://github.com/Prowlarr/Prowlarr/releases

Dosyaları çıkartıp şu klasöre yerleştirin:

```text
resources/prowlarr/
```

Bu klasör bilerek repoya dahil edilmez.

### Çalıştırma
```powershell
npm start
```

### Gelecek Planları
- Kısmi streaming altyapısı
- Manga görüntüleme ve okuma
- Comics görüntüleme ve okuma
