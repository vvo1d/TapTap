# Деплой ТапТапМиллионер на VDS

## Стек продакшна

```
Интернет → Nginx (80/443) → Node.js/Express (3000) → SQLite
```

- **Nginx** — принимает HTTPS, отдаёт статику, проксирует API
- **PM2** — держит Node.js в фоне, перезапускает при падении
- **Let's Encrypt (Certbot)** — бесплатный SSL-сертификат
- **UFW** — файрвол

---

## 1. Подготовка сервера

Подойдёт любой VDS с Ubuntu 22.04 LTS, от 1 CPU / 512 MB RAM.

```bash
# Подключаемся по SSH
ssh root@YOUR_SERVER_IP

# Обновляем систему
apt update && apt upgrade -y

# Создаём пользователя (не работаем под root)
adduser deploy
usermod -aG sudo deploy

# Копируем SSH-ключ для нового пользователя
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Переключаемся
su - deploy
```

---

## 2. Установка Node.js

```bash
# Node.js 20 LTS через NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Проверяем
node -v   # v20.x.x
npm -v    # 10.x.x
```

---

## 3. Установка PM2 и Nginx

```bash
# PM2 — менеджер процессов для Node.js
sudo npm install -g pm2

# Nginx
sudo apt install -y nginx

# Certbot для SSL
sudo apt install -y certbot python3-certbot-nginx
```

---

## 4. Настройка файрвола

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 и 443
sudo ufw enable

sudo ufw status
```

---

## 5. Загрузка кода на сервер

**Вариант A — через Git (рекомендуется):**

```bash
# На сервере
cd /home/deploy
git clone https://github.com/ВАШ_ЮЗЕР/taptap.git app
cd app
```

**Вариант B — через rsync с локальной машины:**

```bash
# На локальной машине (выполняем из папки проекта)
rsync -avz --exclude='node_modules' --exclude='data' --exclude='.git' \
  ./ deploy@YOUR_SERVER_IP:/home/deploy/app/
```

---

## 6. Настройка приложения

```bash
cd /home/deploy/app

# Устанавливаем зависимости (только production)
npm install --omit=dev

# Создаём папку для БД
mkdir -p data

# Создаём файл переменных окружения
cp .env.example .env   # если есть, иначе создаём вручную:
nano .env
```

Содержимое `.env`:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=замените_на_длинную_случайную_строку_минимум_64_символа
```

Генерация безопасного секрета:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 7. Проверяем что `server/index.js` читает `.env`

Убедитесь что в начале `server/index.js` есть:

```js
require('dotenv').config();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
```

И в `server/routes/auth.js` JWT-секрет берётся из `process.env.JWT_SECRET`, а не захардкожен.

---

## 8. Запуск через PM2

```bash
cd /home/deploy/app

# Запускаем приложение
pm2 start server/index.js --name taptap

# Сохраняем список процессов (чтобы выжили после перезагрузки)
pm2 save

# Настраиваем автозапуск при старте системы
pm2 startup
# Команда выведет строку вида: sudo env PATH=... pm2 startup ...
# Выполните её!

# Проверяем статус
pm2 status
pm2 logs taptap --lines 50
```

---

## 9. Настройка DNS домена taptaptap.ru

В панели управления вашим доменом (у регистратора) добавьте A-записи:

| Тип | Имя | Значение        | TTL  |
|-----|-----|-----------------|------|
| A   | @   | YOUR_SERVER_IP  | 3600 |
| A   | www | YOUR_SERVER_IP  | 3600 |

Подождите 5–30 минут для распространения DNS.

Проверка:
```bash
dig taptaptap.ru +short
# Должен вернуть YOUR_SERVER_IP
```

---

## 10. Настройка Nginx

```bash
sudo nano /etc/nginx/sites-available/taptaptap.ru
```

Вставьте конфигурацию:

```nginx
server {
    listen 80;
    server_name taptaptap.ru www.taptaptap.ru;

    # Корень для статики
    root /home/deploy/app;
    index index.html;

    # Gzip-сжатие
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1024;

    # Кэш статических файлов
    location ~* \.(css|js|png|jpg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # API — проксируем на Node.js
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # SPA — всё остальное отдаём index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# Включаем сайт
sudo ln -s /etc/nginx/sites-available/taptaptap.ru /etc/nginx/sites-enabled/

# Удаляем дефолтный сайт
sudo rm -f /etc/nginx/sites-enabled/default

# Проверяем конфигурацию
sudo nginx -t

# Перезапускаем Nginx
sudo systemctl reload nginx
```

---

## 11. SSL-сертификат (HTTPS)

```bash
sudo certbot --nginx -d taptaptap.ru -d www.taptaptap.ru
```

Certbot сам обновит конфиг Nginx и добавит редирект с HTTP на HTTPS.

Проверка автообновления сертификата:
```bash
sudo certbot renew --dry-run
```

---

## 12. Проверка

```bash
# Приложение отвечает
curl https://taptaptap.ru/api/game/businesses | head -c 100

# PM2 работает
pm2 status

# Логи в реальном времени
pm2 logs taptap
```

Откройте браузер: **https://taptaptap.ru** — игра должна работать.

---

## Обновление приложения

```bash
cd /home/deploy/app

# Получаем новый код
git pull

# Если добавились зависимости
npm install --omit=dev

# Перезапускаем без даунтайма
pm2 reload taptap

# Проверяем
pm2 logs taptap --lines 20
```

---

## Бэкап базы данных

SQLite хранится в `data/game.db`. Настройте автоматический бэкап через cron:

```bash
crontab -e
```

Добавьте строку (бэкап каждый день в 3:00):

```cron
0 3 * * * cp /home/deploy/app/data/game.db /home/deploy/backups/game_$(date +\%Y\%m\%d).db
```

```bash
mkdir -p /home/deploy/backups
```

---

## Полезные команды

```bash
pm2 status              # статус процессов
pm2 logs taptap         # логи в реальном времени
pm2 restart taptap      # перезапуск
pm2 stop taptap         # остановка
sudo nginx -t           # проверка конфига Nginx
sudo systemctl reload nginx  # перезагрузка Nginx без даунтайма
sudo journalctl -u nginx -n 50  # логи Nginx
```
