const menuToggle = document.getElementById('menu-toggle');
const mobileMenu = document.getElementById('mobile-menu');

// Open/close the slide-out menu on hamburger click
menuToggle.addEventListener('click', () => {
    // If opening, position the menu right below the header
    if (!mobileMenu.classList.contains('open')) {
        const header = document.querySelector('header.index-grid-header');
        if (header) {
            mobileMenu.style.top = header.offsetHeight + 'px';
        }
    }
    mobileMenu.classList.toggle('open');
});

// Close the menu when clicking anywhere outside of it
document.addEventListener('click', (e) => {
    if (
        mobileMenu.classList.contains('open') &&                 // menu is open
        !mobileMenu.contains(e.target) &&                        // click is not inside menu
        !e.target.closest('#menu-toggle')                        // click is not the toggle button
    ) {
        mobileMenu.classList.remove('open');
    }
});

  if (window.innerWidth <= 768) {
  const header = document.querySelector('.index-grid-header');

  window.addEventListener('scroll', () => {
    const scrolledPast = window.scrollY > 10;
    if (scrolledPast) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}
