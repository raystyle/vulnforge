//! Shared TLS client configs (rustls). Two shapes, one provider:
//!
//! - `roots_agent()` — webpki-verified default (real verification).
//! - `danger_agent()` — zero-verification shape for `--insecure` legs
//!   (self-signed / lab certificates; the channel stays encrypted, only
//!   the chain check is dropped). Mirrors the r-msf / pi-rs2 ruling:
//!   insecure is opt-in and only for authorized lab targets.
//!
//! The ring provider is installed as the process default so
//! `ClientConfig::builder()` never panics on provider ambiguity.

use std::sync::Arc;

use rustls::crypto::ring;
use rustls::ClientConfig;

/// Install the ring provider as the process default (idempotent).
pub fn install_ring_default() {
    let _ = ring::default_provider().install_default();
}

/// Zero-verification client config for --insecure legs.
pub fn danger_client_config() -> Result<Arc<ClientConfig>, String> {
    #[derive(Debug)]
    struct NoVerify;
    impl rustls::client::danger::ServerCertVerifier for NoVerify {
        fn verify_server_cert(
            &self,
            _end_entity: &rustls::pki_types::CertificateDer<'_>,
            _intermediates: &[rustls::pki_types::CertificateDer<'_>],
            _server_name: &rustls::pki_types::ServerName<'_>,
            _ocsp_response: &[u8],
            _now: rustls::pki_types::UnixTime,
        ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(
            &self,
            _message: &[u8],
            _cert: &rustls::pki_types::CertificateDer<'_>,
            _dss: &rustls::DigitallySignedStruct,
        ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
        }
        fn verify_tls13_signature(
            &self,
            _message: &[u8],
            _cert: &rustls::pki_types::CertificateDer<'_>,
            _dss: &rustls::DigitallySignedStruct,
        ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
        }
        fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
            vec![
                rustls::SignatureScheme::RSA_PKCS1_SHA256,
                rustls::SignatureScheme::RSA_PKCS1_SHA384,
                rustls::SignatureScheme::RSA_PKCS1_SHA512,
                rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
                rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
                rustls::SignatureScheme::ED25519,
                rustls::SignatureScheme::RSA_PSS_SHA256,
                rustls::SignatureScheme::RSA_PSS_SHA384,
                rustls::SignatureScheme::RSA_PSS_SHA512,
            ]
        }
    }
    install_ring_default();
    let config = ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerify))
        .with_no_client_auth();
    Ok(Arc::new(config))
}

/// Webpki-rooted default (real verification). The root set is empty in the
/// first batch (lab legs use danger_client_config via --insecure); the
/// webpki-roots crate lands here when production verification is needed.
pub fn roots_client_config() -> Result<Arc<ClientConfig>, String> {
    install_ring_default();
    let roots = rustls::RootCertStore::empty();
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}
