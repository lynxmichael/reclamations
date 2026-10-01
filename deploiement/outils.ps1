# =============================================================================
#  Conteneur d'outils (étape 13) : les scripts de deploiement/ depuis PowerShell, sans WSL ni Git Bash
#
#    .\deploiement\outils.ps1 deploiement/verifier.sh --domaine reclamations.ci --portail alpha
#    .\deploiement\outils.ps1 age-keygen            une paire de clés de sauvegarde (docs/exploitation.md, 5.2)
#    .\deploiement\outils.ps1                       un terminal bash dans le conteneur
#
#  Le conteneur (deploiement/outils/Dockerfile : bash, docker compose, openssl, curl, jq, age) est
#  construit la première fois, puis à chaque modification de son Dockerfile. Il voit le dossier du
#  dépôt en /depot et pilote Docker Desktop par sa socket.
#
#  Si Windows refuse de lancer le script (« l'exécution de scripts est désactivée ») : une fois par
#  fenêtre PowerShell, Set-ExecutionPolicy -Scope Process Bypass
#  Fichier en UTF-8 avec BOM : Windows PowerShell 5.1 en lit ainsi les accents.
# =============================================================================

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { Write-Verbose 'Encodage de la console inchangé (hôte sans console)' }
$OutputEncoding = [System.Text.Encoding]::UTF8

$Racine = Split-Path -Parent $PSScriptRoot
$DossierOutils = Join-Path $PSScriptRoot 'outils'

function Arret([string] $Message) {
    Write-Host "ARRÊT : $Message" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Arret "docker introuvable : installez Docker Desktop (docs/exploitation.md, partie 13)"
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Arret "Docker ne répond pas : lancez Docker Desktop, attendez « Engine running », puis recommencez"
}

# Image étiquetée par l'empreinte de son Dockerfile : reconstruite seulement s'il change
$Empreinte = (Get-FileHash -Algorithm SHA256 (Join-Path $DossierOutils 'Dockerfile')).Hash.Substring(0, 12).ToLower()
$Image = "reclamations-outils:$Empreinte"
docker image inspect $Image *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Construction du conteneur d'outils ($Image), une seule fois : une à deux minutes"
    docker build --tag $Image $DossierOutils
    if ($LASTEXITCODE -ne 0) { Arret "construction du conteneur d'outils impossible (connexion à Internet ?)" }
}

# Un terminal (-t) seulement si la fenêtre est interactive : les questions (« Continuer ? ») s'y posent
$Options = @('run', '--rm', '--interactive')
if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) { $Options += '--tty' }
$Options += @(
    '--volume', '/var/run/docker.sock:/var/run/docker.sock',
    '--volume', "${Racine}:/depot",
    '--workdir', '/depot',
    '--env', 'REPETITION_PORT_MAILPIT',
    $Image
)

# Un script .sh se lance par bash : les droits d'exécution ne traversent pas le partage de fichiers Windows
$Commande = @($args)
if ($Commande.Count -eq 0) { $Commande = @('bash') }
elseif ([string]$Commande[0] -like '*.sh') { $Commande = @('bash') + $Commande }

& docker @Options @Commande
exit $LASTEXITCODE
