document.addEventListener('DOMContentLoaded', function () {
	document.querySelectorAll('.convert-date').forEach(function(el){
		const timestamp = el.innerText.toString().substring(0,8)
		const date = new Date( parseInt( timestamp, 16 ) * 1000 )
		el.innerHTML = [date.getDate(),date.getMonth()+1,date.getFullYear()].join('-') + ' ' + [date.getHours(),date.getMinutes()].join(':')
	})
})
