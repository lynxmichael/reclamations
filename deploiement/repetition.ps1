# =============================================================================
#  Répétition locale complète du déploiement (étape 13), depuis PowerShell
#
#    .\deploiement\repetition.ps1 installer         la production, comme sur le VPS
#    .\deploiement\repetition.ps1 verifier          contrôle du déploiement (--portail <slug>)
#    .\deploiement\repetition.ps1 sauvegarde        sauvegarde, vérification, liste des copies
#    .\deploiement\repetition.ps1 intrusion         copies effacées avec les clés : alerte, restauration
#    .\deploiement\repetition.ps1 restauration      remplacement de la base par la dernière sauvegarde
#    .\deploiement\repetition.ps1 mise-a-jour 1.0.1 puis : retour
#    .\deploiement\repetition.ps1 demo              la démonstration (arrête la production : mêmes ports)
#    .\deploiement\repetition.ps1 etat | arreter | demarrer | supprimer   (--demo : la démonstration)
#    .\deploiement\repetition.ps1 aide              toutes les commandes
#
#  Les commandes sont celles de deploiement/repetition.sh, lancé dans le conteneur d'outils
#  (deploiement/outils.ps1). Ce script y ajoute ce qui relève de Windows : l'autorité de
#  certification locale de Caddy est ajoutée aux autorités de confiance de l'utilisateur (Windows
#  demande de confirmer), pour que Edge, Chrome et Firefox affichent le cadenas ; elle en est retirée
#  par « supprimer ». Guide : docs/exploitation.md, partie 13.
#
#  Si Windows refuse de lancer le script (« l'exécution de scripts est désactivée ») : une fois par
#  fenêtre PowerShell, Set-ExecutionPolicy -Scope Process Bypass
#  Fichier en UTF-8 avec BOM : Windows PowerShell 5.1 en lit ainsi les accents.
# =============================================================================

$Racine = Split-Path -Parent $PSScriptRoot
$Commande = if ($args.Count -gt 0) { [string]$args[0] } else { 'aide' }
$Demo = ($Commande -eq 'demo') -or ($args -contains '--demo')
$Dossier = Join-Path $Racine (Join-Path '.repetition' $(if ($Demo) { 'demonstration' } else { 'production' }))
$FichierAutorite = Join-Path $Dossier 'autorite-locale.crt'
$FichierEmpreinte = Join-Path $Dossier 'autorite-locale.windows'
$SurWindows = $env:OS -eq 'Windows_NT'

# Magasin « Autorités de certification racines de confiance » de l'utilisateur (sans droits d'administrateur)
function Ouvrir-Magasin {
    $magasin = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
    $magasin.Open('ReadWrite')
    return $magasin
}

function Retirer-Autorite([string] $Empreinte) {
    if (-not $SurWindows -or -not $Empreinte) { return }
    $magasin = Ouvrir-Magasin
    try {
        $trouves = $magasin.Certificates.Find('FindByThumbprint', $Empreinte, $false)
        foreach ($c in $trouves) {
            Write-Host "Retrait de l'autorité locale « $($c.Subject) » : Windows demande de confirmer, répondez Oui."
            $magasin.Remove($c)
        }
    } finally { $magasin.Close() }
}

function Importer-Autorite {
    if (-not $SurWindows -or -not (Test-Path $FichierAutorite)) { return }
    $certificat = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($FichierAutorite)
    $ancienne = if (Test-Path $FichierEmpreinte) { (Get-Content $FichierEmpreinte -Raw).Trim() } else { '' }
    if ($ancienne -and $ancienne -ne $certificat.Thumbprint) { Retirer-Autorite $ancienne }
    $magasin = Ouvrir-Magasin
    try {
        if ($magasin.Certificates.Find('FindByThumbprint', $certificat.Thumbprint, $false).Count -eq 0) {
            Write-Host ""
            Write-Host "Autorité locale « $($certificat.Subject) » ajoutée aux autorités de confiance de Windows :" -ForegroundColor Yellow
            Write-Host "Windows demande de confirmer (avertissement de sécurité), répondez Oui. Firefox : le redémarrer." -ForegroundColor Yellow
            $magasin.Add($certificat)
        }
    } catch {
        Write-Host "Autorité locale non ajoutée ($($_.Exception.Message)) : les navigateurs afficheront un avertissement." -ForegroundColor Yellow
        Write-Host "Pour réessayer : .\deploiement\repetition.ps1 demarrer$(if ($Demo) { ' --demo' })" -ForegroundColor Yellow
        return
    } finally { $magasin.Close() }
    Set-Content -Path $FichierEmpreinte -Value $certificat.Thumbprint -Encoding ASCII
    Write-Host "Autorité locale de confiance sur ce poste (empreinte $($certificat.Thumbprint))."
}

# L'empreinte est lue avant « supprimer », qui efface le dossier .repetition\…
$EmpreinteAvant = if (Test-Path $FichierEmpreinte) { (Get-Content $FichierEmpreinte -Raw).Trim() } else { '' }

& (Join-Path $PSScriptRoot 'outils.ps1') 'deploiement/repetition.sh' @args
$Code = $LASTEXITCODE

if ($Code -eq 0) {
    switch ($Commande) {
        { $_ -in @('installer', 'demo', 'demarrer') } { Importer-Autorite }
        'supprimer' { if (-not (Test-Path $Dossier)) { Retirer-Autorite $EmpreinteAvant } }
    }
}
exit $Code
