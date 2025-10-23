use crate::error::ProxyError;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use std::fs;
use std::path::PathBuf;
use tracing::{error, info};

pub struct DaemonManager {
    pid_file: PathBuf,
}

impl DaemonManager {
    pub fn new() -> Result<Self, ProxyError> {
        let pid_dir = dirs::data_local_dir()
            .ok_or_else(|| ProxyError::InternalError("Cannot find data directory".to_string()))?
            .join("proxy-ai-fusion");

        // Create directory if it doesn't exist
        fs::create_dir_all(&pid_dir).map_err(|e| {
            ProxyError::InternalError(format!("Failed to create PID directory: {}", e))
        })?;

        let pid_file = pid_dir.join("paf.pid");

        Ok(Self { pid_file })
    }

    /// Write the current process PID to file
    pub fn write_pid(&self) -> Result<(), ProxyError> {
        let pid = std::process::id();
        fs::write(&self.pid_file, pid.to_string()).map_err(|e| {
            ProxyError::InternalError(format!("Failed to write PID file: {}", e))
        })?;
        info!("PID file written: {:?} (PID: {})", self.pid_file, pid);
        Ok(())
    }

    /// Read PID from file
    pub fn read_pid(&self) -> Result<Option<u32>, ProxyError> {
        if !self.pid_file.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&self.pid_file).map_err(|e| {
            ProxyError::InternalError(format!("Failed to read PID file: {}", e))
        })?;

        let pid = content.trim().parse::<u32>().map_err(|e| {
            ProxyError::InternalError(format!("Invalid PID in file: {}", e))
        })?;

        Ok(Some(pid))
    }

    /// Remove PID file
    pub fn remove_pid(&self) -> Result<(), ProxyError> {
        if self.pid_file.exists() {
            fs::remove_file(&self.pid_file).map_err(|e| {
                ProxyError::InternalError(format!("Failed to remove PID file: {}", e))
            })?;
            info!("PID file removed: {:?}", self.pid_file);
        }
        Ok(())
    }

    /// Check if process is running
    pub fn is_running(&self) -> Result<bool, ProxyError> {
        match self.read_pid()? {
            Some(pid) => Ok(self.check_process_exists(pid)),
            None => Ok(false),
        }
    }

    /// Check if a process with given PID exists
    fn check_process_exists(&self, pid: u32) -> bool {
        // Try to send signal 0 (null signal) to check if process exists
        // Signal 0 doesn't actually send a signal, just checks if the process exists
        match signal::kill(Pid::from_raw(pid as i32), None) {
            Ok(_) => true,
            Err(nix::errno::Errno::ESRCH) => false, // Process doesn't exist
            Err(nix::errno::Errno::EPERM) => true,  // Process exists but no permission
            Err(_) => false,
        }
    }

    /// Stop the daemon process
    pub fn stop(&self) -> Result<(), ProxyError> {
        match self.read_pid()? {
            Some(pid) => {
                info!("Stopping process with PID: {}", pid);

                // Send SIGTERM to gracefully stop the process
                match signal::kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
                    Ok(_) => {
                        info!("SIGTERM sent to process {}", pid);
                        // Wait a bit for graceful shutdown
                        std::thread::sleep(std::time::Duration::from_secs(2));

                        // Check if still running, if so send SIGKILL
                        if self.check_process_exists(pid) {
                            info!("Process still running, sending SIGKILL");
                            signal::kill(Pid::from_raw(pid as i32), Signal::SIGKILL).ok();
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }

                        self.remove_pid()?;
                        info!("Process stopped successfully");
                        Ok(())
                    }
                    Err(nix::errno::Errno::ESRCH) => {
                        // Process doesn't exist
                        self.remove_pid()?;
                        Err(ProxyError::InternalError(
                            "Process not found (stale PID file removed)".to_string(),
                        ))
                    }
                    Err(e) => Err(ProxyError::InternalError(format!(
                        "Failed to stop process: {}",
                        e
                    ))),
                }
            }
            None => Err(ProxyError::InternalError(
                "No PID file found (service not running?)".to_string(),
            )),
        }
    }

    /// Get PID file path
    pub fn get_pid_file(&self) -> &PathBuf {
        &self.pid_file
    }

    /// Daemonize the current process
    pub fn daemonize(&self) -> Result<(), ProxyError> {
        use nix::unistd::{fork, setsid, ForkResult};
        use std::os::unix::io::AsRawFd;

        // First fork
        match unsafe { fork() } {
            Ok(ForkResult::Parent { .. }) => {
                // Parent exits
                std::process::exit(0);
            }
            Ok(ForkResult::Child) => {
                // Child continues
            }
            Err(e) => {
                return Err(ProxyError::InternalError(format!("Fork failed: {}", e)));
            }
        }

        // Create new session
        setsid().map_err(|e| ProxyError::InternalError(format!("setsid failed: {}", e)))?;

        // Second fork to ensure we're not a session leader
        match unsafe { fork() } {
            Ok(ForkResult::Parent { .. }) => {
                // Parent exits
                std::process::exit(0);
            }
            Ok(ForkResult::Child) => {
                // Child continues
            }
            Err(e) => {
                return Err(ProxyError::InternalError(format!(
                    "Second fork failed: {}",
                    e
                )));
            }
        }

        // Change working directory to root
        std::env::set_current_dir("/").map_err(|e| {
            ProxyError::InternalError(format!("Failed to change directory: {}", e))
        })?;

        // Close standard file descriptors
        unsafe {
            libc::close(std::io::stdin().as_raw_fd());
            libc::close(std::io::stdout().as_raw_fd());
            libc::close(std::io::stderr().as_raw_fd());
        }

        // Redirect to /dev/null
        let dev_null = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/null")
            .map_err(|e| ProxyError::InternalError(format!("Failed to open /dev/null: {}", e)))?;

        unsafe {
            libc::dup2(dev_null.as_raw_fd(), 0);
            libc::dup2(dev_null.as_raw_fd(), 1);
            libc::dup2(dev_null.as_raw_fd(), 2);
        }

        Ok(())
    }
}
