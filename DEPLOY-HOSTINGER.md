# Deploy na VPS Ubuntu existente

Esta versão funciona sem GPT Sites: cadastro público por e-mail e senha, sessões de 12 horas, SQLite inicialmente vazio e comprovantes persistentes. E-mail é um identificador; não há envio de confirmação. Cada conta vê apenas seus dados. Senhas de no mínimo 12 caracteres são armazenadas como hash scrypt com salt.

O deploy padrão sobe **somente este aplicativo**, em `127.0.0.1:3087`, usando o proxy/HTTPS existente. Não ocupa 80/443 e não exige Node ou npm no Ubuntu: o container inclui Node 24.

## 1. Identificar os serviços existentes

No SSH da VPS, execute estas consultas:

```bash
docker --version
docker compose version
sudo ss -ltnp
docker ps --format 'table {{.Names}}\t{{.Ports}}'
systemctl is-active nginx apache2 caddy
```

Confirme que 3087 está livre; caso contrário, escolha outra `APP_PORT`. Os últimos comandos identificam quem atende 80/443. Se Docker/Compose não existir, siga a [instalação oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Não remova ou reinstale o Docker que já executa seus serviços.

## 2. Enviar e configurar

No computador, dentro da pasta do projeto, envie o pacote fornecido, substituindo usuário e IP:

```powershell
scp reembolso-vps.tar.gz USUARIO@IP_DA_VPS:~/
```

Na VPS, use uma pasta exclusiva deste app:

```bash
sudo mkdir -p /opt/reembolso-vps
sudo chown "$(id -u):$(id -g)" /opt/reembolso-vps
cd /opt/reembolso-vps
tar -xzf ~/reembolso-vps.tar.gz
cp .env.vps.example .env.vps
nano .env.vps
```

Preencha o domínio sem protocolo nem barra final:

```dotenv
APP_DOMAIN=risti.com.br
APP_PORT=3087
ADMIN_EMAIL=
```

Deixe `ADMIN_EMAIL` vazio para cadastro normal. Para ativar `/admin`, veja o passo 6.

## 3. Iniciar

Execute em `/opt/reembolso-vps`; mantenha o nome de projeto `reembolso-vps` para conservar o volume de dados:

```bash
docker compose --env-file .env.vps -p reembolso-vps up -d --build app
docker compose --env-file .env.vps -p reembolso-vps ps
docker compose --env-file .env.vps -p reembolso-vps logs --tail=60 app
curl -I http://127.0.0.1:3087/login
```

O último comando deve retornar HTTP 200. Ajuste a porta se mudou `APP_PORT`. O login de produção será feito pelo domínio HTTPS, não pelo IP/HTTP.

## 4. DNS

Crie um registro `A` para o domínio raiz (`@`, para `risti.com.br`) apontando ao IPv4 da VPS. Altere somente esse nome, preservando os outros serviços e registros de e-mail. Não mantenha AAAA desse nome apontando a outro servidor. Confira com `nslookup risti.com.br`. A propagação pode levar até 24 horas. [Guia oficial da Hostinger](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/).

## 5. Proxy existente e HTTPS

Use apenas a opção correspondente à sua VPS. Não substitua configurações dos outros apps.

### Nginx instalado diretamente no Ubuntu

Primeiro verifique se já existe um bloco para o domínio:

```bash
sudo nginx -T 2>&1 | grep -n -B 3 -A 15 'server_name.*risti\.com\.br'
```

Se já existir, adapte apenas o bloco desse domínio: mantenha seus certificados e configuração HTTPS, configure `client_max_body_size 4m` e use o `location /` abaixo. Não crie outro `server_name risti.com.br`. Essa troca faz o domínio raiz passar a servir o sistema de despesas; se ele hospeda um site que deve continuar, use um subdomínio e altere `APP_DOMAIN` e `server_name` juntos.

Se ainda não existir, copie o arquivo fornecido:

```bash
sudo cp deploy/nginx-risti.conf /etc/nginx/sites-available/reembolso-vps
```

O conteúdo de `/etc/nginx/sites-available/reembolso-vps` será (ajuste a porta se necessário):

```nginx
server {
    listen 80;
    server_name risti.com.br;
    client_max_body_size 4m;
    location / {
        proxy_pass http://127.0.0.1:3087;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache off;
    }
}
```

Para um arquivo novo, ative e valide. Se adaptou um bloco existente, execute somente `sudo nginx -t`:

```bash
sudo ln -s /etc/nginx/sites-available/reembolso-vps /etc/nginx/sites-enabled/reembolso-vps
sudo nginx -t
```

Somente se a validação passar:

```bash
sudo systemctl reload nginx
```

Se a instalação já usa Certbot com plugin Nginx:

```bash
sudo certbot --nginx -d risti.com.br --redirect
sudo certbot renew --dry-run
```

Se HTTPS é administrado por painel/outra ferramenta, use a ferramenta existente. [Referência oficial do Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

### Proxy em Docker ou painel

Dentro de um container, `127.0.0.1` é o próprio container, não o Ubuntu. Conecte o app à rede Docker do proxy e use o nome/alias do serviço e a porta `3000` como destino. A configuração final depende do painel e da rede existentes; identifique-os antes de alterar. Não exponha a porta 3000 publicamente como atalho.

## 6. Cadastro e administrador opcional

Abra `https://risti.com.br`, clique em **Não tenho conta · Criar cadastro**, informe e-mail e senha. O cadastro já inicia sua sessão. Crie cliente, projeto e uma despesa com foto; saia e entre para conferir. Uma segunda conta deve começar vazia.

Para `/admin`, reserve seu e-mail em `ADMIN_EMAIL` antes de abrir o cadastro público. Esse endereço não pode ser cadastrado pela tela. Crie a conta pelo terminal, com senha digitada sem exibição:

```bash
docker compose --env-file .env.vps -p reembolso-vps up -d app
docker compose --env-file .env.vps -p reembolso-vps exec app node server/users.js create voce@seudominio.com.br
```

O administrador consulta/edita apenas os dados da própria conta. Não promova um e-mail de conta desconhecida: o cadastro público não verifica a propriedade do endereço.

Para redefinir uma senha e encerrar as sessões anteriores:

```bash
docker compose --env-file .env.vps -p reembolso-vps exec app node server/users.js password pessoa@dominio.com
```

## 7. Backup e atualização

O volume `reembolso-vps_app_data` contém `expenses.sqlite`, arquivos auxiliares SQLite e `receipts`. Os dados sobrevivem à reconstrução do container. Não use `docker compose down -v`, que apaga volumes.

Backup consistente com uma breve parada somente deste app:

```bash
cd /opt/reembolso-vps
mkdir -p backups
docker compose --env-file .env.vps -p reembolso-vps stop app
docker compose --env-file .env.vps -p reembolso-vps run --rm --no-deps -T app tar -C /data -czf - . > "backups/reembolso-$(date +%F-%H%M%S).tar.gz"
docker compose --env-file .env.vps -p reembolso-vps start app
```

Confira se o backup terminou sem erro; mantenha cópia fora da VPS e copie `.env.vps` separadamente. O backup contém dados privados e hashes de senha. Para restaurar, pare o app, preserve o volume atual e extraia o backup em um volume vazio com usuário `node`; não misture SQLite ativo com backup antigo.

Para atualizar, faça backup, extraia o novo pacote na mesma pasta (não contém `.env.vps`) e execute:

```bash
docker compose --env-file .env.vps -p reembolso-vps up -d --build app
```

Não há migração dos dados do Sites, conforme solicitado. `npm run dev` e `npm run build` preservam o fluxo antigo do Sites. A VPS executa `server/vps.js` diretamente. Para testar localmente com Node 24: `npm start` e abra `http://localhost:3000`; os dados ficam em `.vps-data`.

## Erro “Origem não autorizada” no cadastro ou login

O endereço aberto no navegador deve corresponder exatamente ao APP_ORIGIN do servidor (protocolo, domínio e porta). No Docker Compose deste projeto, esse valor é https:// seguido de APP_DOMAIN. Por exemplo, APP_DOMAIN=risti.com.br exige acesso por https://risti.com.br; www.risti.com.br, IP, HTTP ou outra porta não são equivalentes.

Confira o valor em execução:

```bash
docker compose --env-file .env.vps -p reembolso-vps exec app printenv APP_ORIGIN
```

Ajuste APP_DOMAIN no .env.vps para o domínio HTTPS utilizado e recrie o serviço:

```bash
docker compose --env-file .env.vps -p reembolso-vps up -d --build app
```

Acesse novamente pelo endereço configurado. Não desative a validação de origem para contornar o erro.
